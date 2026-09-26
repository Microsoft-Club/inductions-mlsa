-- The results table also says which panel interviewed each candidate (cancelled send-ins left out),
-- so admins see it without opening every record. Same signature, so grants are unchanged.
create or replace function public.results_table() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ind uuid;
begin
  perform public.require_role('admin');
  v_ind := public.require_active_induction();
  return coalesce((
    with ev as (
      select i.candidate_id, e.scores, e.recommendation
        from public.evaluations e
        join public.interviews i on i.id = e.interview_id
       where i.induction_id = v_ind and i.status <> 'cancelled'
    ), scores as (
      select ev.candidate_id, s.key, (s.value)::numeric as val
        from ev
        cross join lateral jsonb_each(ev.scores) as s
       where jsonb_typeof(s.value) = 'number'
    ), per_criterion as (
      select x.candidate_id, jsonb_object_agg(x.key, x.avg) as avgs
        from (select candidate_id, key, round(avg(val), 2) as avg
                from scores group by candidate_id, key) x
       group by x.candidate_id
    ), general as (
      select sc.candidate_id, round(avg(sc.val), 2) as avg
        from scores sc
        join public.evaluation_criteria ec
          on ec.induction_id = v_ind and ec.key = sc.key and ec.category = 'general'
       group by sc.candidate_id
    ), tally as (
      select t.candidate_id, jsonb_object_agg(t.recommendation, t.n) as counts, sum(t.n)::int as total
        from (select candidate_id, recommendation::text as recommendation, count(*) as n
                from ev group by candidate_id, recommendation) t
       group by t.candidate_id
    ), interviewed as (
      select i.candidate_id, jsonb_agg(p.name order by i.started_at) as names
        from public.interviews i
        join public.panels p on p.id = i.panel_id
       where i.induction_id = v_ind and i.status <> 'cancelled'
       group by i.candidate_id
    )
    select jsonb_agg(jsonb_build_object(
             'candidate_id', c.id,
             'number', c.number,
             'reg_number', c.reg_number,
             'full_name', c.full_name,
             'department', c.department,
             'batch', c.batch,
             'preferences', to_jsonb(c.preferences),
             'status', c.status,
             'decision', c.decision,
             'panels', coalesce(iv.names, '[]'::jsonb),
             'evaluation_count', coalesce(tl.total, 0),
             'general_avg', g.avg,
             'criteria_avgs', coalesce(pc.avgs, '{}'::jsonb),
             'recommendations', coalesce(tl.counts, '{}'::jsonb))
           order by c.number)
      from public.candidates c
      left join per_criterion pc on pc.candidate_id = c.id
      left join general g on g.candidate_id = c.id
      left join tally tl on tl.candidate_id = c.id
      left join interviewed iv on iv.candidate_id = c.id
     where c.induction_id = v_ind
  ), '[]'::jsonb);
end $$;
