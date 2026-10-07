begin;
select no_plan();

-- Undo send-in is for "the wrong person went in": once the panel has evaluated the interview it is
-- refused, so evaluations never quietly drop out of the results. Chat alone doesn't block it.
select tests.reset_app();
select tests.create_user('qm_one', 'queue_manager');
select tests.create_user('boss', 'admin');
select tests.create_user('pan_one', 'panelist');
select tests.add_candidate(n) from generate_series(1, 3) as n;
select tests.seat('pan_one', 'Panel 1');

select tests.login_as('qm_one');
select public.check_in(tests.candidate_id(n)) from generate_series(1, 3) as n;

-- #1: the panel only chatted, then the desk undoes: still allowed.
select public.send_in(tests.candidate_id(1), tests.panel_id('Panel 1'));
select tests.login_as('pan_one');
select public.post_message(tests.interview_id(1), 'Is this the right person?', null);
select tests.login_as('qm_one');
select lives_ok(format('select public.undo_send_in(%L)', tests.interview_id(1)), 'an interview with only chat can be undone');
select is(tests.status(1), 'waiting', 'and the candidate is waiting again');
select is(tests.lane('Panel 1'), array[1], 'at the top of the panel''s line');

-- #2: a panelist has evaluated: Undo is refused and nothing changes.
select public.send_in(tests.candidate_id(2), tests.panel_id('Panel 1'));
select tests.login_as('pan_one');
select public.submit_evaluation(tests.interview_id(2), '{"communication": 4}', 'yes', '');
select tests.login_as('qm_one');
select throws_ok(format('select public.undo_send_in(%L)', tests.interview_id(2)), 'P0001',
  'The panel has already evaluated #2; use End interview instead', 'the desk cannot undo an interview the panel has evaluated');
select is((select status::text from public.interviews where id = tests.interview_id(2)), 'in_progress', 'the interview is still on');
select is(tests.status(2), 'interviewing', 'the candidate is still interviewing');
select tests.login_as('boss');
select throws_ok(format('select public.undo_send_in(%L)', tests.interview_id(2)), 'P0001',
  'The panel has already evaluated #2; use End interview instead', 'an admin cannot either');
select is((select (r ->> 'evaluation_count')::int from jsonb_array_elements(public.results_table()) as r where (r ->> 'number')::int = 2),
  1, 'the evaluation still counts in the results');
select lives_ok(format('select public.end_interview(%L)', tests.interview_id(2)), 'ending it works as usual');

-- An evaluation can no longer land on a cancelled interview.
select tests.login_as('qm_one');
select public.send_in(tests.candidate_id(3), tests.panel_id('Panel 1'));
select public.undo_send_in(tests.interview_id(3));
select tests.login_as('pan_one');
select throws_ok(format($$select public.submit_evaluation(%L, '{}', 'yes', '')$$, tests.interview_id(3)), 'P0001',
  'Interview not found', 'a cancelled interview takes no evaluation');
select is((select count(*)::int from public.evaluations where interview_id = tests.interview_id(3)), 0, 'none was stored');

-- submit_evaluation still behaves as before for ended interviews.
select lives_ok(format($$select public.submit_evaluation(%L, '{"teamwork": 5}', 'strong_yes', 'later')$$, tests.interview_id(2)),
  'an ended interview can still be evaluated');

select * from finish();
rollback;
