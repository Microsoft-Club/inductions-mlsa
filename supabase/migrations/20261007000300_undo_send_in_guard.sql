-- Undo send-in is for "the wrong person went in". Once anyone on the panel has evaluated the interview,
-- cancelling it would drop those evaluations from the results, the panelists' lists and the exports, so
-- it is refused: the desk ends the interview instead. Chat alone doesn't block it (a panel may well
-- write "this isn't who we expected" before the desk undoes it).
create or replace function public.undo_send_in(p_interview_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid;
  v_ind uuid;
  v_i public.interviews;
  v_number int;
begin
  v_uid := public.require_role('admin', 'queue_manager');
  v_ind := public.require_active_induction();
  perform public.lock_queue(v_ind);
  select * into v_i from public.interviews where id = p_interview_id and induction_id = v_ind for update;
  if not found or v_i.status <> 'in_progress' then
    raise exception 'Interview is not in progress';
  end if;
  if exists (select 1 from public.evaluations where interview_id = v_i.id) then
    select number into v_number from public.candidates where id = v_i.candidate_id;
    raise exception 'The panel has already evaluated #%; use End interview instead', v_number;
  end if;
  update public.interviews
     set status = 'cancelled', ended_at = clock_timestamp(), ended_by = v_uid
   where id = v_i.id;
  update public.candidates set status = 'waiting', updated_at = clock_timestamp() where id = v_i.candidate_id;
  update public.queue_entries set position = position + 1 where induction_id = v_ind and panel_id = v_i.panel_id;
  insert into public.queue_entries (candidate_id, induction_id, panel_id, position)
  values (v_i.candidate_id, v_ind, v_i.panel_id, 1);
  perform public.broadcast_board();
end $$;

-- An evaluation submitted at the same instant as Undo send-in: the interview row is now share-locked
-- while the evaluation is saved, so the two run one after the other. Either the evaluation lands first
-- and Undo is refused, or Undo lands first and the evaluation is refused ("Interview not found");
-- an evaluation can no longer end up on a cancelled interview. Same signature, so grants are unchanged.
create or replace function public.submit_evaluation(
  p_interview_id uuid, p_scores jsonb, p_recommendation public.recommendation, p_comments text
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid;
  v_ind public.inductions;
  v_bad text;
  v_count int;
begin
  v_uid := public.require_role('admin', 'panelist');
  select * into v_ind from public.inductions where is_active;
  if not found then
    raise exception 'No active induction';
  end if;
  if v_ind.results_published then
    raise exception 'Results are published; evaluations are locked';
  end if;
  perform 1 from public.interviews
   where id = p_interview_id and induction_id = v_ind.id and status <> 'cancelled'
     for share;
  if not found then
    raise exception 'Interview not found';
  end if;
  if p_recommendation is null then
    raise exception 'Recommendation is required';
  end if;
  if p_scores is null or jsonb_typeof(p_scores) <> 'object' then
    raise exception 'Scores must be an object';
  end if;

  select s.key into v_bad
    from jsonb_each(p_scores) as s
   where not exists (
           select 1 from public.evaluation_criteria ec where ec.induction_id = v_ind.id and ec.key = s.key)
      or not (jsonb_typeof(s.value) = 'null'
              or (jsonb_typeof(s.value) = 'number' and (s.value)::numeric in (1, 2, 3, 4, 5)))
   order by s.key
   limit 1;
  if v_bad is not null then
    raise exception 'Invalid score for %', v_bad;
  end if;
  if length(coalesce(p_comments, '')) > 5000 then
    raise exception 'Comments must be at most 5000 characters';
  end if;

  insert into public.evaluations (interview_id, panelist_id, scores, recommendation, comments, submitted_at, updated_at)
  values (p_interview_id, v_uid, jsonb_strip_nulls(p_scores), p_recommendation, trim(coalesce(p_comments, '')),
          clock_timestamp(), clock_timestamp())
  on conflict (interview_id, panelist_id) do update
    set scores = excluded.scores,
        recommendation = excluded.recommendation,
        comments = excluded.comments,
        updated_at = excluded.updated_at;

  select count(*) into v_count from public.evaluations where interview_id = p_interview_id;
  perform public.broadcast_interview(p_interview_id, 'evaluation', jsonb_build_object('count', v_count));
end $$;
