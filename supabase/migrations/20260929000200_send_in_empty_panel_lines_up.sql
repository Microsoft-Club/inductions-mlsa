-- Send in to a panel nobody is sitting in lines the person up at the front of that panel instead of
-- starting an interview with no one there; the desk sends them in once someone has joined the panel.
-- Returns the new interview's id, or null when the person was lined up instead.
create or replace function public.send_in(p_candidate_id uuid, p_panel_id uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid;
  v_ind uuid;
  v_c public.candidates;
  v_p public.panels;
  v_lane uuid;
  v_interview_id uuid;
begin
  v_uid := public.require_role('admin', 'queue_manager');
  v_ind := public.require_active_induction();
  perform public.lock_queue(v_ind);
  select * into v_c from public.candidates where id = p_candidate_id and induction_id = v_ind for update;
  if not found then
    raise exception 'Candidate not found';
  end if;
  if v_c.status <> 'waiting' then
    raise exception 'Candidate #% is not waiting', v_c.number;
  end if;
  select * into v_p from public.panels where id = p_panel_id and induction_id = v_ind and deleted_at is null;
  if not found then
    raise exception 'Panel not found';
  end if;
  if exists (select 1 from public.interviews where panel_id = v_p.id and status = 'in_progress') then
    raise exception '% is busy', v_p.name;
  end if;
  if not exists (select 1 from public.profiles where current_panel_id = v_p.id and is_active) then
    perform public.move_candidate(v_c.id, v_p.id, 1);
    return null;
  end if;

  select panel_id into v_lane from public.queue_entries where candidate_id = v_c.id;
  delete from public.queue_entries where candidate_id = v_c.id;
  perform public.renumber_lane(v_ind, v_lane);

  insert into public.interviews (induction_id, candidate_id, panel_id, status, started_at, started_by)
  values (v_ind, v_c.id, v_p.id, 'in_progress', clock_timestamp(), v_uid)
  returning id into v_interview_id;
  update public.candidates set status = 'interviewing', updated_at = clock_timestamp() where id = v_c.id;

  perform public.broadcast_board();
  return v_interview_id;
end $$;
