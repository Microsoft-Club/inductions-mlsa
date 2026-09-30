begin;
select no_plan();

-- Brainees, the fifth team: panelists rate team fit for it like the other four, and results average it.
select tests.reset_app();
select is((select jsonb_build_object('label', label, 'category', category, 'sort_order', sort_order)
             from public.evaluation_criteria where key = 'fit_brainees'),
          '{"label": "Brainees", "category": "team_fit", "sort_order": 10}'::jsonb,
          'a new induction rates Brainees fit, after the other teams');

select tests.create_user('qm_one', 'queue_manager');
select tests.create_user('pan_one', 'panelist');
select tests.create_user('boss', 'admin');
select tests.add_candidate(1);
select tests.seat('pan_one', 'Panel 1');
select tests.login_as('qm_one');
select public.check_in(tests.candidate_id(1));
select public.send_in(tests.candidate_id(1), tests.panel_id('Panel 1'));
select tests.login_as('pan_one');
select lives_ok($$ select public.submit_evaluation(tests.interview_id(1), '{"communication": 4, "fit_brainees": 5}', 'yes', '') $$,
                'a panelist can score Brainees fit');
select tests.login_as('boss');
select set_config('tests.results', public.results_table()::text, true);
select is(tests.result_for(1) -> 'criteria_avgs' -> 'fit_brainees', '5.00'::jsonb, 'results average the Brainees fit');

select * from finish();
rollback;
