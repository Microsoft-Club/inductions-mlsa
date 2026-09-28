-- Only the panelists sitting in an interview's panel may end it. The queue manager and admins can still
-- end any interview (for example one that runs over because its panel forgot to press End).
create or replace function public.end_interview(p_interview_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid;
  v_ind uuid;
  v_i public.interviews;
  v_panel_name text;
begin
  v_uid := public.require_role('admin', 'queue_manager', 'panelist');
  v_ind := public.require_active_induction();
  perform public.lock_queue(v_ind);
  select * into v_i from public.interviews where id = p_interview_id and induction_id = v_ind for update;
  if not found or v_i.status <> 'in_progress' then
    raise exception 'Interview is not in progress';
  end if;
  if public.current_app_role() = 'panelist'
     and (select current_panel_id from public.profiles where id = v_uid) is distinct from v_i.panel_id then
    select name into v_panel_name from public.panels where id = v_i.panel_id;
    raise exception 'Only panelists sitting in % can end this interview', v_panel_name;
  end if;
  update public.interviews
     set status = 'ended', ended_at = clock_timestamp(), ended_by = v_uid
   where id = v_i.id;
  update public.candidates set status = 'interviewed', updated_at = clock_timestamp() where id = v_i.candidate_id;
  perform public.broadcast_board();
end $$;
