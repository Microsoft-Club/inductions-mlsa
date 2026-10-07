begin;
select no_plan();

-- A panelist's pending interviews: the panel's ended interviews they haven't evaluated, however many
-- interviews the panel has had since (the Recent list itself only loads the latest 30).
select tests.reset_app();
select tests.create_user('qm_one', 'queue_manager');
select tests.create_user('boss', 'admin');
select tests.create_user('pan_one', 'panelist');
select tests.create_user('pan_two', 'panelist');
select tests.add_candidate(n) from generate_series(1, 36) as n;
select tests.seat('pan_one', 'Panel 1');
select tests.seat('pan_two', 'Panel 1');

create function pg_temp.pending(p_panel text) returns int[] language sql as $$
  select coalesce(array_agg((r -> 'candidate' ->> 'number')::int order by ord), '{}')
    from jsonb_array_elements(public.my_pending_interviews(tests.panel_id(p_panel))) with ordinality as t(r, ord)
$$;

-- 34 interviews on Panel 1; pan_one evaluates all but #1 and #2. #35 is still on.
select tests.login_as('qm_one');
select public.check_in(tests.candidate_id(n)) from generate_series(1, 36) as n;
do $$
begin
  for n in 1..34 loop
    perform tests.login_as('qm_one');
    perform public.send_in(tests.candidate_id(n), tests.panel_id('Panel 1'));
    perform tests.login_as('pan_one');
    perform public.end_interview(tests.interview_id(n));
    if n > 2 then
      perform public.submit_evaluation(tests.interview_id(n), '{}', 'maybe', '');
    end if;
  end loop;
end $$;
select tests.login_as('qm_one');
select public.send_in(tests.candidate_id(35), tests.panel_id('Panel 1'));

select tests.login_as('pan_one');
select is(pg_temp.pending('Panel 1'), array[2, 1], 'the two unevaluated interviews from 32 interviews ago, newest first');
select is(jsonb_typeof(public.my_pending_interviews(tests.panel_id('Panel 1')) -> 0 -> 'candidate' -> 'full_name'), 'string',
  'rows carry the candidate''s name, like the Recent list');
select is(public.my_pending_interviews(tests.panel_id('Panel 1')) -> 0 ->> 'status', 'ended', 'and their status');

select tests.login_as('pan_two');
select is(array_length(pg_temp.pending('Panel 1'), 1), 34, 'another panelist has their own pending list (the one in progress is not pending)');

select tests.login_as('pan_one');
select public.submit_evaluation(tests.interview_id(1), '{}', 'yes', '');
select is(pg_temp.pending('Panel 1'), array[2], 'evaluating one takes it off');
select is(pg_temp.pending('Panel 2'), '{}'::int[], 'another panel has none');

select tests.login_as('qm_one');
select public.end_interview(tests.interview_id(35));
select tests.login_as('pan_one');
select is(pg_temp.pending('Panel 1'), array[35, 2], 'a newly ended one is pending');

-- A cancelled send-in is never pending.
select tests.login_as('qm_one');
select public.send_in(tests.candidate_id(36), tests.panel_id('Panel 1'));
select public.undo_send_in(tests.interview_id(36));
select tests.login_as('pan_one');
select is(pg_temp.pending('Panel 1'), array[35, 2], 'an undone send-in is not pending');

select tests.login_as('qm_one');
select throws_ok(format('select public.my_pending_interviews(%L)', tests.panel_id('Panel 1')), '42501', 'Not allowed',
  'the queue manager has no evaluations to owe');
select tests.login_as('boss');
select lives_ok(format('select public.my_pending_interviews(%L)', tests.panel_id('Panel 1')), 'admins evaluate too');

select * from finish();
rollback;
