-- Google Form sync. An Apps Script on the form's responses sheet sends each new response to the
-- form-sync edge function, which calls sync_form_response as the service role. The response is
-- imported with the CSV import's rules; what the CSV import would flag in its dialog is kept as a
-- warning on the queue board instead, until a queue manager or admin dismisses it.

create table public.form_warnings (
  id uuid primary key default gen_random_uuid(),
  induction_id uuid not null references public.inductions (id) on delete cascade,
  reg_number text not null default '',
  name text not null default '',
  reason text not null check (length(reason) between 1 and 1000),
  created_at timestamptz not null default clock_timestamp(),
  dismissed_at timestamptz,
  dismissed_by uuid references public.profiles (id) on delete set null
);
-- One open copy of each warning, so two responses arriving at once can't show the same one twice.
-- md5: a reason can be long, and index entries have a size limit.
create unique index form_warnings_open_once_idx on public.form_warnings (induction_id, reg_number, name, md5(reason))
  where dismissed_at is null;

-- Read and written only through the functions below.
alter table public.form_warnings enable row level security;
revoke all on public.form_warnings from anon, authenticated;

-- The import itself, shared by the CSV import and the form sync. The caller checks who is asking,
-- picks the induction and tells the board.
create function public.import_candidates_core(p_ind uuid, p_rows jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_next int;
  v_added int := 0;
  v_updated int := 0;
  v_new_ids uuid[];
  v_flags jsonb;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Import data must be a list of rows';
  end if;
  perform public.lock_queue(p_ind);

  -- Flags: rows without a reg number are skipped.
  select coalesce(jsonb_agg(jsonb_build_object(
           'reg_number', '',
           'name', coalesce(trim(t.x ->> 'full_name'), ''),
           'reason', 'Missing registration number; row skipped') order by t.ord), '[]'::jsonb)
    into v_flags
    from jsonb_array_elements(p_rows) with ordinality as t(x, ord)
   where public.normalize_reg(t.x ->> 'reg_number') = '';

  -- Flags: the same person submitted more than once.
  v_flags := v_flags || coalesce((
    select jsonb_agg(jsonb_build_object(
             'reg_number', d.reg_number,
             'name', d.full_name,
             'reason', format('Duplicate submission (%s responses); kept the latest', d.response_count))
           order by d.reg_number)
      from public.import_rows_dedup(p_rows) d
     where d.response_count > 1), '[]'::jsonb);

  -- Existing candidates: refresh application data only. Never number/status/queue/decision.
  update public.candidates c
     set full_name = d.full_name,
         email = d.email,
         account_email = d.account_email,
         phone = d.phone,
         department = d.department,
         batch = d.batch,
         preferences = d.preferences,
         answers = d.answers,
         submitted_at = least(c.submitted_at, d.first_submitted_at),
         updated_at = clock_timestamp()
    from public.import_rows_dedup(p_rows) d
   where c.induction_id = p_ind
     and c.reg_number = d.reg_number
     and (c.full_name, c.email, c.account_email, c.phone, c.department, c.batch, c.preferences, c.answers)
         is distinct from
         (d.full_name, d.email, d.account_email, d.phone, d.department, d.batch, d.preferences, d.answers);
  get diagnostics v_updated = row_count;

  -- New candidates: numbered in submission order after the current highest number.
  select coalesce(max(number), 0) into v_next from public.candidates where induction_id = p_ind;
  with inserted as (
    insert into public.candidates (induction_id, number, reg_number, full_name, email, account_email, phone,
                                   department, batch, submitted_at, preferences, answers)
    select p_ind,
           v_next + row_number() over (order by d.first_submitted_at, d.reg_number),
           d.reg_number, d.full_name, d.email, d.account_email, d.phone, d.department, d.batch,
           d.first_submitted_at, d.preferences, d.answers
      from public.import_rows_dedup(p_rows) d
     where not exists (
       select 1 from public.candidates c where c.induction_id = p_ind and c.reg_number = d.reg_number)
    returning id
  )
  select count(*)::int, coalesce(array_agg(id), '{}') into v_added, v_new_ids from inserted;

  -- Flags: a NEW candidate whose email belongs to a lower-numbered candidate (existing or new).
  v_flags := v_flags || coalesce((
    select jsonb_agg(jsonb_build_object(
             'reg_number', n.reg_number,
             'name', n.full_name,
             'reason', format('Possible reg number typo; email matches #%s', m.number))
           order by n.number)
      from public.candidates n
      join lateral (
        select c.number
          from public.candidates c
         where c.induction_id = p_ind
           and c.number < n.number
           and exists (
             select 1
               from unnest(array[lower(n.email), lower(n.account_email)]) as e(addr)
              where e.addr <> '' and e.addr in (lower(c.email), lower(c.account_email)))
         order by c.number
         limit 1) m on true
     where n.id = any (v_new_ids)), '[]'::jsonb);

  return jsonb_build_object('added', v_added, 'updated', v_updated, 'flagged', v_flags);
end $$;

-- The CSV import (queue managers and admins); its flags are shown in the import dialog.
create or replace function public.import_candidates(p_rows jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_result jsonb;
begin
  perform public.require_role('admin', 'queue_manager');
  v_result := public.import_candidates_core(public.require_active_induction(), p_rows);
  perform public.broadcast_board();
  return v_result;
end $$;

-- Keeps flags as board warnings. A warning that is already showing is not added again.
create function public.store_form_warnings(p_ind uuid, p_flags jsonb) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.form_warnings (induction_id, reg_number, name, reason)
  select distinct p_ind, f.reg_number, f.name, f.reason
    from jsonb_to_recordset(p_flags) as f(reg_number text, name text, reason text)
  on conflict do nothing
$$;

-- One response from the Google Form, sent by the form-sync edge function.
create function public.sync_form_response(p_row jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ind uuid;
  v_reg text;
  v_earlier_name text;
  v_latest_name text;
  v_result jsonb;
begin
  v_ind := public.require_active_induction();
  if p_row is null or jsonb_typeof(p_row) <> 'object' then
    raise exception 'A form response must be one row';
  end if;
  v_reg := public.normalize_reg(p_row ->> 'reg_number');
  perform public.lock_queue(v_ind);
  select full_name into v_earlier_name from public.candidates where induction_id = v_ind and reg_number = v_reg;

  v_result := public.import_candidates_core(v_ind, jsonb_build_array(p_row));

  -- One response at a time can't be a "duplicate submission", so a later response for a reg number
  -- already on the list is flagged here instead (it may be someone else who mistyped theirs).
  if v_earlier_name is not null and (v_result ->> 'updated')::int > 0 then
    select full_name into v_latest_name from public.candidates where induction_id = v_ind and reg_number = v_reg;
    v_result := jsonb_set(v_result, '{flagged}', (v_result -> 'flagged') || jsonb_build_array(jsonb_build_object(
      'reg_number', v_reg,
      'name', v_latest_name,
      'reason', 'Another response came in for this reg number; kept the latest answers'
                || case when v_earlier_name not in ('', v_latest_name) then format(' (earlier name: %s)', v_earlier_name)
                        else '' end)));
  end if;

  perform public.store_form_warnings(v_ind, v_result -> 'flagged');
  perform public.broadcast_board();
  return v_result;
end $$;

-- A response the edge function could not read (e.g. the form's questions changed).
create function public.note_form_problem(p_reason text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ind uuid;
begin
  v_ind := public.require_active_induction();
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A problem needs a description';
  end if;
  perform public.store_form_warnings(v_ind, jsonb_build_array(jsonb_build_object(
    'reg_number', '', 'name', '', 'reason', left(trim(p_reason), 1000))));
  perform public.broadcast_board();
end $$;

create function public.dismiss_form_warning(p_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid;
begin
  v_uid := public.require_role('admin', 'queue_manager');
  update public.form_warnings
     set dismissed_at = clock_timestamp(), dismissed_by = v_uid
   where id = p_id and induction_id = public.require_active_induction() and dismissed_at is null;
  perform public.broadcast_board();
end $$;

-- The live board, now with the form warnings (queue managers and admins only; newest first).
create or replace function public.board_snapshot() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ind public.inductions;
begin
  perform public.require_role('admin', 'queue_manager', 'panelist');
  select * into v_ind from public.inductions where is_active;
  if not found then
    raise exception 'No active induction';
  end if;
  return jsonb_build_object(
    'induction', jsonb_build_object(
      'id', v_ind.id,
      'name', v_ind.name,
      'target_interview_minutes', v_ind.target_interview_minutes,
      'results_published', v_ind.results_published),
    'server_time', clock_timestamp(),
    'counts', (
      select jsonb_build_object(
               'registered', count(*) filter (where c.status = 'registered'),
               'waiting', count(*) filter (where c.status = 'waiting'),
               'interviewing', count(*) filter (where c.status = 'interviewing'),
               'interviewed', count(*) filter (where c.status = 'interviewed'))
        from public.candidates c
       where c.induction_id = v_ind.id),
    'panels', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id,
               'name', p.name,
               'is_default', p.is_default,
               'current', (
                 select jsonb_build_object(
                          'interview_id', i.id, 'candidate_id', c.id, 'number', c.number,
                          'name', c.full_name, 'reg_number', c.reg_number, 'started_at', i.started_at)
                   from public.interviews i
                   join public.candidates c on c.id = i.candidate_id
                  where i.panel_id = p.id and i.status = 'in_progress'),
               'last_ended', (
                 select jsonb_build_object(
                          'interview_id', i.id, 'candidate_id', c.id, 'number', c.number,
                          'name', c.full_name, 'ended_at', i.ended_at)
                   from public.interviews i
                   join public.candidates c on c.id = i.candidate_id
                  where i.id = public.panel_reopenable_interview(p.id)),
               'lane', public.lane_json(v_ind.id, p.id),
               'panelists', coalesce((
                 select jsonb_agg(jsonb_build_object('id', pr.id, 'display_name', pr.display_name)
                                  order by pr.display_name)
                   from public.profiles pr
                  where pr.current_panel_id = p.id and pr.is_active), '[]'::jsonb))
             order by p.sort_order)
        from public.panels p
       where p.induction_id = v_ind.id and p.deleted_at is null), '[]'::jsonb),
    'pool', public.lane_json(v_ind.id, null),
    'form_warnings', case when public.has_role('admin', 'queue_manager') then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', w.id, 'reg_number', w.reg_number, 'name', w.name, 'reason', w.reason, 'created_at', w.created_at)
             order by w.created_at desc, w.id)
        from public.form_warnings w
       where w.induction_id = v_ind.id and w.dismissed_at is null), '[]'::jsonb)
      else '[]'::jsonb end
  );
end $$;

revoke execute on function public.import_candidates_core(uuid, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.store_form_warnings(uuid, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.sync_form_response(jsonb) from public, anon, authenticated;
revoke execute on function public.note_form_problem(text) from public, anon, authenticated;
grant execute on function public.sync_form_response(jsonb) to service_role;
grant execute on function public.note_form_problem(text) to service_role;
revoke execute on function public.dismiss_form_warning(uuid) from public, anon;
grant execute on function public.dismiss_form_warning(uuid) to authenticated;
