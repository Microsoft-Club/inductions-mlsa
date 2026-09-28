begin;
select no_plan();

select tests.reset_app();
select tests.create_user('qm_one', 'queue_manager');
select tests.create_user('pan_one', 'panelist');
select tests.create_user('pan_two', 'panelist');
select tests.create_user('boss', 'admin');
select tests.add_candidate(1);
select tests.add_candidate(2);

-- Someone sits in each panel people are sent into (send in lines people up for an empty panel).
select tests.create_user('seat_one', 'panelist');
select tests.seat('seat_one', 'Panel 1');
select tests.login_as('qm_one');
select public.check_in(tests.candidate_id(1));
select public.send_in(tests.candidate_id(1), tests.panel_id('Panel 1'));
select throws_ok($$ select public.post_message(tests.interview_id(1), 'hi') $$, '42501', 'Not allowed', 'the queue manager cannot chat');

-- chat
select tests.login_as('pan_one');
select is(public.post_message(tests.interview_id(1), '  Strong backend  ') ->> 'body', 'Strong backend', 'message saved, trimmed');
select is(public.interview_messages(tests.interview_id(1)) -> 0 ->> 'author_name', 'Pan One', 'messages carry the author name');
select throws_ok($$ select public.post_message(tests.interview_id(1), '   ') $$, 'P0001', 'Message must be 1 to 2000 characters', 'empty message rejected');
select throws_ok($$ select public.post_message(tests.interview_id(1), repeat('x', 2001)) $$, 'P0001', 'Message must be 1 to 2000 characters', 'long message rejected');
select public.post_message(tests.interview_id(1), 'Ask about Docker', '11111111-1111-1111-1111-111111111111');
select public.post_message(tests.interview_id(1), 'Ask about Docker', '11111111-1111-1111-1111-111111111111');
select is(jsonb_array_length(public.interview_messages(tests.interview_id(1))), 2, 'a retry with the same id does not duplicate');

select tests.login_as('pan_two');
select is((select count(*)::int from public.messages), 2, 'other panelists read the chat');
select throws_ok($$ select public.post_message(tests.interview_id(1), 'x', '11111111-1111-1111-1111-111111111111') $$,
                 'P0001', 'Message id already used', 'cannot reuse someone else''s message id');

-- evaluations
select tests.login_as('pan_one');
select lives_ok($$ select public.submit_evaluation(tests.interview_id(1), '{"communication": 4, "fit_dev": null}', 'yes', ' good ') $$,
                'a panelist submits an evaluation');
select is((select scores from public.evaluations), '{"communication": 4}'::jsonb, 'N/A scores are dropped');
select is((select comments from public.evaluations), 'good', 'comments trimmed');
select throws_ok($$ select public.submit_evaluation(tests.interview_id(1), '{"nope": 3}', 'yes', '') $$, 'P0001', 'Invalid score for nope', 'unknown criterion rejected');
select throws_ok($$ select public.submit_evaluation(tests.interview_id(1), '{"communication": 6}', 'yes', '') $$, 'P0001', 'Invalid score for communication', 'out-of-range score rejected');
select throws_ok($$ select public.submit_evaluation(tests.interview_id(1), '{"communication": 2.5}', 'yes', '') $$, 'P0001', 'Invalid score for communication', 'fractional score rejected');
select throws_ok($$ select public.submit_evaluation(tests.interview_id(1), '{}', null, '') $$, 'P0001', 'Recommendation is required', 'recommendation required');
select throws_ok($$ select public.submit_evaluation(tests.interview_id(1), '{}', 'yes', repeat('x', 5001)) $$, 'P0001', 'Comments must be at most 5000 characters', 'comments length limited');
select public.submit_evaluation(tests.interview_id(1), '{"communication": 5}', 'strong_yes', '');
select is((select recommendation::text from public.evaluations), 'strong_yes', 'resubmitting updates the same evaluation');
select is((select count(*)::int from public.evaluations), 1, 'still one evaluation');

select tests.login_as('pan_two');
select public.submit_evaluation(tests.interview_id(1), '{"communication": 3}', 'maybe', '');
select is(public.evaluation_count(tests.interview_id(1)), 2, 'the count includes everyone');
select is((select count(*)::int from public.evaluations), 1, 'but a panelist reads only their own');

select tests.login_as('boss');
select is((select count(*)::int from public.evaluations), 2, 'admins read all evaluations');

-- ended interviews can still be evaluated; cancelled ones cannot be evaluated or chatted in
select tests.login_as('qm_one');
select public.end_interview(tests.interview_id(1));
select public.check_in(tests.candidate_id(2));
select public.send_in(tests.candidate_id(2), tests.panel_id('Panel 1'));
select public.undo_send_in(tests.interview_id(2));
select tests.login_as('pan_one');
select lives_ok($$ select public.submit_evaluation(tests.interview_id(1), '{}', 'yes', '') $$, 'evaluate after the interview ends');
select throws_ok($$ select public.submit_evaluation(tests.interview_id(2), '{}', 'yes', '') $$, 'P0001', 'Interview not found', 'cancelled interviews cannot be evaluated');
select throws_ok($$ select public.post_message(tests.interview_id(2), 'x') $$, 'P0001', 'Interview not found', 'or chatted in');

-- publishing results locks evaluations
select tests.as_postgres();
update public.inductions set results_published = true where is_active;
select tests.login_as('pan_one');
select throws_ok($$ select public.submit_evaluation(tests.interview_id(1), '{}', 'no', '') $$, 'P0001',
                 'Results are published; evaluations are locked', 'locked after publishing');

select * from finish();
rollback;
