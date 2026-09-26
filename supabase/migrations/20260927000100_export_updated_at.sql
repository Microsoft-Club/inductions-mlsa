-- The evaluations export also says when each evaluation last changed (panelists can update theirs
-- until results are published). Same signature, so grants are unchanged.
create or replace function public.evaluations_export() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ind uuid;
begin
  perform public.require_role('admin');
  v_ind := public.require_active_induction();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'number', c.number,
             'reg_number', c.reg_number,
             'full_name', c.full_name,
             'panel', p.name,
             'panelist', pr.display_name,
             'scores', e.scores,
             'recommendation', e.recommendation,
             'comments', e.comments,
             'submitted_at', e.submitted_at,
             'updated_at', e.updated_at)
           order by c.number, p.name, pr.display_name)
      from public.evaluations e
      join public.interviews i on i.id = e.interview_id
      join public.candidates c on c.id = i.candidate_id
      join public.panels p on p.id = i.panel_id
      join public.profiles pr on pr.id = e.panelist_id
     where i.induction_id = v_ind and i.status <> 'cancelled'), '[]'::jsonb);
end $$;
