-- After End, a panel is "wrapping up" until one of its panelists says it is ready for the next person,
-- so the queue manager's board can tell a panel still scoring from one waiting for someone.
alter table public.interviews
  add column ready_at timestamptz,
  add column ready_by uuid references public.profiles (id) on delete set null;

-- Interviews that ended before this existed count as ready, so no panel turns amber on deploy.
update public.interviews set ready_at = ended_at where status = 'ended';

-- A panelist sitting in the interview's panel (or an admin) says the panel is ready for the next person.
-- Ready unlocks 15 seconds after the interview ended, so End then Ready can't be pressed by reflex.
-- The queue manager doesn't need this: they can send someone in anyway.
create function public.mark_panel_ready(p_interview_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid;
  v_ind uuid;
  v_i public.interviews;
  v_panel_name text;
begin
  v_uid := public.require_role('admin', 'panelist');
  v_ind := public.require_active_induction();
  perform public.lock_queue(v_ind);
  select * into v_i from public.interviews where id = p_interview_id and induction_id = v_ind for update;
  if not found then
    raise exception 'Interview not found';
  end if;
  select name into v_panel_name from public.panels where id = v_i.panel_id;
  if public.current_app_role() = 'panelist'
     and (select current_panel_id from public.profiles where id = v_uid) is distinct from v_i.panel_id then
    raise exception 'Only panelists sitting in % can say it is ready', v_panel_name;
  end if;
  if v_i.status <> 'ended' then
    raise exception 'The interview has not ended';
  end if;
  if public.panel_reopenable_interview(v_i.panel_id) is distinct from v_i.id then
    raise exception 'This is no longer %''s latest interview', v_panel_name;
  end if;
  if v_i.ready_at is not null then
    return; -- another panelist got there first
  end if;
  if clock_timestamp() < v_i.ended_at + interval '15 seconds' then
    raise exception 'Ready unlocks 15 seconds after the interview ends';
  end if;
  update public.interviews set ready_at = clock_timestamp(), ready_by = v_uid where id = v_i.id;
  perform public.broadcast_board();
end $$;

-- Reopening puts the panel back in the interview, so the next End needs a fresh Ready.
create or replace function public.reopen_interview(p_interview_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_ind uuid;
  v_i public.interviews;
  v_p public.panels;
begin
  perform public.require_role('admin', 'queue_manager');
  v_ind := public.require_active_induction();
  perform public.lock_queue(v_ind);
  select * into v_i from public.interviews where id = p_interview_id and induction_id = v_ind for update;
  if not found or v_i.status <> 'ended' then
    raise exception 'Interview cannot be reopened';
  end if;
  select * into v_p from public.panels where id = v_i.panel_id;
  if v_p.deleted_at is not null then
    raise exception 'Panel not found';
  end if;
  if exists (select 1 from public.interviews where panel_id = v_i.panel_id and status = 'in_progress') then
    raise exception '% is busy', v_p.name;
  end if;
  if public.panel_reopenable_interview(v_i.panel_id) is distinct from v_i.id then
    raise exception 'Only the most recent interview can be reopened';
  end if;
  update public.interviews set status = 'in_progress', ended_at = null, ended_by = null, ready_at = null, ready_by = null where id = v_i.id;
  update public.candidates set status = 'interviewing', updated_at = clock_timestamp() where id = v_i.candidate_id;
  perform public.broadcast_board();
end $$;

-- The live board: each panel's last ended interview now says when the panel became ready (null while wrapping up).
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
                          'name', c.full_name, 'ended_at', i.ended_at, 'ready_at', i.ready_at)
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

revoke execute on function public.mark_panel_ready(uuid) from public, anon;
grant execute on function public.mark_panel_ready(uuid) to authenticated;
