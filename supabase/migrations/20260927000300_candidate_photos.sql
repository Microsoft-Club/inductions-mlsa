-- Candidate photos (spec: docs/superpowers/specs/2026-09-27-candidate-photos-design.md).
-- The files live in Cloudflare R2. The database records who has a photo and decides who may take or
-- see one: the photo API (functions/api/photos) calls the authorize_*, record_photo and clear_photos
-- functions below with the signed-in user's own token.

-- Functions compare role::text, so the new value is never needed as an enum literal in this transaction.
alter type public.app_role add value if not exists 'photographer';

-- null = no photo. updated_at is left alone: it tracks the application and the decision.
alter table public.candidates
  add column photo_taken_at timestamptz,
  add column photo_taken_by uuid references public.profiles (id) on delete set null;

-- Every active account can read its own profile (the app learns its role from it). Photographers get
-- nothing else; the staff policy still lets admins, queue managers and panelists read every profile.
create policy "read own profile" on public.profiles for select to authenticated
  using (id = (select auth.uid()) and is_active);

-- The board's "changed" signal carries only a timestamp; the photographer's list reloads on it.
drop policy "staff receive board broadcasts" on realtime.messages;
create policy "staff receive board broadcasts" on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'board'
    and (select public.has_role('admin', 'queue_manager', 'panelist', 'photographer'))
  );

-- The queue board marks who has a photo (the queue manager's camera icon and Send in question).
create or replace function public.lane_json(p_induction_id uuid, p_panel_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'candidate_id', c.id, 'number', c.number, 'name', c.full_name, 'reg_number', c.reg_number,
           'position', q.position, 'skip_count', q.skip_count, 'checked_in_at', c.checked_in_at,
           'has_photo', c.photo_taken_at is not null)
         order by q.position), '[]'::jsonb)
    from public.queue_entries q
    join public.candidates c on c.id = q.candidate_id
   where q.induction_id = p_induction_id and q.panel_id is not distinct from p_panel_id
$$;

-- Where a candidate's photo lives in the bucket.
create function public.photo_key(p_induction_id uuid, p_candidate_id uuid) returns text
language sql immutable set search_path = '' as $$
  select p_induction_id::text || '/' || p_candidate_id::text || '.jpg'
$$;

-- The candidate a photo upload is about, after the checks every upload shares. Queue managers and
-- admins may photograph anyone in the active induction; photographers only people in these statuses.
create function public.photo_candidate(p_candidate_id uuid, p_photographer_statuses text[]) returns public.candidates
language plpgsql stable security definer set search_path = '' as $$
declare
  v_c public.candidates;
begin
  perform public.require_role('admin', 'queue_manager', 'photographer');
  select * into v_c from public.candidates
   where id = p_candidate_id and induction_id = public.require_active_induction();
  if not found then
    raise exception 'Candidate not found';
  end if;
  if public.current_app_role() = 'photographer' and not (v_c.status::text = any (p_photographer_statuses)) then
    raise exception 'Candidate #% is not waiting', v_c.number;
  end if;
  return v_c;
end $$;

-- The photographer's list: everyone waiting (in the pool or lined up), earliest check-in first.
create function public.photo_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ind uuid;
begin
  perform public.require_role('admin', 'photographer');
  v_ind := public.require_active_induction();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'candidate_id', c.id, 'number', c.number, 'name', c.full_name,
             'checked_in_at', c.checked_in_at, 'photo_taken_at', c.photo_taken_at)
           order by c.checked_in_at, c.number)
      from public.candidates c
     where c.induction_id = v_ind and c.status = 'waiting'), '[]'::jsonb);
end $$;

-- Before a file is saved: may this user photograph this candidate? Returns the file key.
create function public.authorize_photo_upload(p_candidate_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_c public.candidates;
begin
  v_c := public.photo_candidate(p_candidate_id, array['waiting']);
  return public.photo_key(v_c.induction_id, v_c.id);
end $$;

-- After the file is saved. A photographer's photo still counts if the candidate was sent in meanwhile.
create function public.record_photo(p_candidate_id uuid) returns timestamptz
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_c public.candidates;
  v_at timestamptz := clock_timestamp();
begin
  v_c := public.photo_candidate(p_candidate_id, array['waiting', 'interviewing']);
  update public.candidates set photo_taken_at = v_at, photo_taken_by = auth.uid() where id = v_c.id;
  perform public.broadcast_board();
  return v_at;
end $$;

-- May this user see this candidate's photo? The file key, or null when there is no photo.
create function public.authorize_photo_view(p_candidate_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_c public.candidates;
begin
  perform public.require_role('admin', 'queue_manager', 'panelist', 'photographer');
  select * into v_c from public.candidates where id = p_candidate_id;
  -- Photographers see only who is waiting now; asking about anyone else is refused outright.
  if public.current_app_role() = 'photographer'
     and (v_c.id is null or v_c.status is distinct from 'waiting'
          or v_c.induction_id is distinct from public.active_induction_id()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_c.id is null or v_c.photo_taken_at is null then
    return null;
  end if;
  return public.photo_key(v_c.induction_id, v_c.id);
end $$;

-- How many candidates have a photo, across all inductions (the Delete all confirmation).
create function public.photo_count() returns int
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_role('admin');
  return (select count(*)::int from public.candidates where photo_taken_at is not null);
end $$;

-- Before the bucket is emptied: is this an admin?
create function public.authorize_photo_purge() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_role('admin');
end $$;

-- After the bucket is emptied: nobody has a photo any more. Returns how many records were cleared.
create function public.clear_photos() returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_count int;
begin
  perform public.require_role('admin');
  update public.candidates set photo_taken_at = null, photo_taken_by = null where photo_taken_at is not null;
  get diagnostics v_count = row_count;
  perform public.broadcast_board();
  return v_count;
end $$;

revoke execute on function public.photo_key(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.photo_candidate(uuid, text[]) from public, anon, authenticated;
revoke execute on function public.photo_queue(), public.authorize_photo_upload(uuid), public.record_photo(uuid),
  public.authorize_photo_view(uuid), public.photo_count(), public.authorize_photo_purge(), public.clear_photos()
  from public, anon;
grant execute on function public.photo_queue(), public.authorize_photo_upload(uuid), public.record_photo(uuid),
  public.authorize_photo_view(uuid), public.photo_count(), public.authorize_photo_purge(), public.clear_photos()
  to authenticated;
