-- Brainees, the fifth team (added to the Google Form on 30 September): panelists rate team fit for
-- it like the other four teams. New inductions get the criterion from create_induction; the active
-- induction gets it now. Evaluations already submitted simply have no Brainees score (N/A).

create or replace function public.create_induction(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  update public.inductions set is_active = false where is_active;
  insert into public.inductions (name, is_active) values (p_name, true) returning id into v_id;
  insert into public.panels (induction_id, name, is_default, sort_order)
  values (v_id, 'Panel 1', true, 1), (v_id, 'Panel 2', true, 2);
  insert into public.evaluation_criteria (induction_id, key, label, category, sort_order) values
    (v_id, 'communication', 'Communication', 'general', 1),
    (v_id, 'confidence_attitude', 'Confidence & Attitude', 'general', 2),
    (v_id, 'teamwork', 'Teamwork', 'general', 3),
    (v_id, 'commitment', 'Commitment', 'general', 4),
    (v_id, 'problem_solving', 'Problem Solving', 'general', 5),
    (v_id, 'fit_dev', 'Dev', 'team_fit', 6),
    (v_id, 'fit_logikal', 'LogiKal', 'team_fit', 7),
    (v_id, 'fit_lnd', 'L&D', 'team_fit', 8),
    (v_id, 'fit_marketing', 'Marketing', 'team_fit', 9),
    (v_id, 'fit_brainees', 'Brainees', 'team_fit', 10);
  return v_id;
end $$;

insert into public.evaluation_criteria (induction_id, key, label, category, sort_order)
select id, 'fit_brainees', 'Brainees', 'team_fit', 10 from public.inductions where is_active
on conflict (induction_id, key) do nothing;
