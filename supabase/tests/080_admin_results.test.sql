begin;
select no_plan();

select tests.reset_app();
select tests.create_user('qm_one', 'queue_manager');
select tests.create_user('pan_one', 'panelist');
select tests.create_user('pan_two', 'panelist');
select tests.create_user('boss', 'admin');
select tests.add_candidate(n) from generate_series(1, 3) as n;

-- #1: two evaluations. #2: a cancelled interview, then one evaluation with only N/A scores. #3: never interviewed.
-- Someone sits in each panel people are sent into (send in lines people up for an empty panel).
select tests.create_user('seat_one', 'panelist');
select tests.create_user('seat_two', 'panelist');
select tests.seat('seat_one', 'Panel 1');
select tests.seat('seat_two', 'Panel 2');
select tests.login_as('qm_one');
select public.check_in(tests.candidate_id(n)) from generate_series(1, 2) as n;
select public.send_in(tests.candidate_id(2), tests.panel_id('Panel 2'));
select public.undo_send_in(tests.interview_id(2));
select public.send_in(tests.candidate_id(1), tests.panel_id('Panel 1'));
select public.send_in(tests.candidate_id(2), tests.panel_id('Panel 2'));
select tests.login_as('pan_one');
select public.submit_evaluation(tests.interview_id(1), '{"communication": 4, "teamwork": 2, "fit_dev": 5}', 'strong_yes', 'great');
select public.submit_evaluation(tests.interview_id(2), '{"fit_dev": null}', 'maybe', '');
select tests.login_as('pan_two');
select public.submit_evaluation(tests.interview_id(1), '{"communication": 5, "fit_dev": 3}', 'yes', '');
-- an evaluation left on the cancelled interview must not count
select tests.as_postgres();
insert into public.evaluations (interview_id, panelist_id, scores, recommendation)
select i.id, tests.user_id('pan_two'), '{"communication": 1}', 'no' from public.interviews i where i.status = 'cancelled';

select tests.login_as('qm_one');
select throws_ok($$ select public.results_table() $$, '42501', 'Not allowed', 'results are admin-only');

select tests.login_as('boss');
select set_config('tests.results', public.results_table()::text, true);
select is(tests.result_for(1) -> 'evaluation_count', '2'::jsonb, '#1 has two evaluations');
select is(tests.result_for(1) -> 'general_avg', '3.67'::jsonb, 'general average over the general scores (4, 2, 5)');
select is(tests.result_for(1) -> 'criteria_avgs' -> 'fit_dev', '4.00'::jsonb, 'team-fit average');
select is(tests.result_for(1) -> 'recommendations', '{"strong_yes": 1, "yes": 1}'::jsonb, 'recommendation tally');
-- Review focus 5: blanks, not errors
select is(tests.result_for(2) -> 'evaluation_count', '1'::jsonb, 'cancelled-interview evaluations are excluded');
select is(tests.result_for(2) -> 'general_avg', 'null'::jsonb, 'all-N/A scores give a null average');
select is(tests.result_for(2) -> 'criteria_avgs', '{}'::jsonb, 'and no criteria averages');
select is(tests.result_for(3) -> 'evaluation_count', '0'::jsonb, 'never-interviewed candidates are listed');

-- decisions and publishing
select public.set_decision(tests.candidate_id(1), 'selected');
select public.set_decision(tests.candidate_id(2), 'not_selected');
select is((select decision::text from public.candidates where number = 1), 'selected', 'decision saved');
select throws_ok($$ select public.set_decision(gen_random_uuid(), 'selected') $$, 'P0001', 'Candidate not found', 'unknown candidate');

select tests.logout();
select is((select count(*)::int from public.published_results()), 0, 'nothing is public before publishing');
select tests.login_as('boss');
select public.set_results_published(true);
select tests.logout();
select results_eq($$ select full_name, reg_number from public.published_results() $$,
                  $$ values ('Candidate 1'::text, 'T000001'::text) $$,
                  'only selected candidates are published, name and reg number only');

-- projector key
select tests.login_as('qm_one');
select throws_ok($$ select public.get_display_key() $$, '42501', 'Not allowed', 'only admins see the projector key');
select tests.login_as('boss');
select is(public.get_display_key(), tests.display_key(), 'admin reads the projector key');
select set_config('tests.old_key', tests.display_key(), true);
select is(length(public.regenerate_display_key()), 48, 'a new 48-character key');
select tests.logout();
select is(public.display_snapshot(current_setting('tests.old_key')), null::jsonb, 'the old projector link stops working');
select isnt(public.display_snapshot(tests.display_key()), null::jsonb, 'the new link works');

-- settings
select tests.login_as('boss');
select public.update_settings('Fall 2026 Inductions', 20);
select is(public.board_snapshot() -> 'induction' ->> 'name', 'Fall 2026 Inductions', 'name updated');
select is((public.board_snapshot() -> 'induction' ->> 'target_interview_minutes')::int, 20, 'target length updated');
select throws_ok($$ select public.update_settings('x', 0) $$, 'P0001', 'Target interview length must be 1 to 180 minutes', 'invalid length rejected');
select throws_ok($$ select public.update_settings('  ', 15) $$, 'P0001', 'Name must be 1 to 80 characters', 'blank name rejected');

-- candidate record and export
select is(jsonb_array_length(public.candidate_record(tests.candidate_id(1)) -> 'interviews'), 1, 'the record lists interviews');
select is(jsonb_array_length(public.candidate_record(tests.candidate_id(1)) -> 'interviews' -> 0 -> 'evaluations'), 2, 'with every evaluation');
select is(public.candidate_record(tests.candidate_id(1)) -> 'candidate' ->> 'full_name', 'Candidate 1', 'and the candidate details');
select throws_ok($$ select public.candidate_record(gen_random_uuid()) $$, 'P0001', 'Candidate not found', 'unknown candidate record');
select is(jsonb_array_length(public.evaluations_export()), 3, 'export has one row per evaluation, cancelled excluded');

select * from finish();
rollback;
