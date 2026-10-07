-- The panel's ended interviews the signed-in panelist hasn't evaluated yet, however long ago they were.
-- The panelist's Recent list loads the panel's latest 30 interviews; an older one still owed an
-- evaluation fell off that list and out of the Pending count. The screen adds these to Recent.
-- Rows have the Recent list's shape (id, status, started_at, ended_at, candidate {id, number, full_name}).
create function public.my_pending_interviews(p_panel_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid;
  v_ind uuid;
begin
  v_uid := public.require_role('admin', 'panelist');
  v_ind := public.require_active_induction();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', i.id, 'status', i.status, 'started_at', i.started_at, 'ended_at', i.ended_at,
             'candidate', jsonb_build_object('id', c.id, 'number', c.number, 'full_name', c.full_name))
           order by i.started_at desc)
      from public.interviews i
      join public.candidates c on c.id = i.candidate_id
     where i.panel_id = p_panel_id
       and i.induction_id = v_ind
       and i.status = 'ended'
       and not exists (select 1 from public.evaluations e where e.interview_id = i.id and e.panelist_id = v_uid)), '[]'::jsonb);
end $$;

revoke execute on function public.my_pending_interviews(uuid) from public, anon;
grant execute on function public.my_pending_interviews(uuid) to authenticated;
