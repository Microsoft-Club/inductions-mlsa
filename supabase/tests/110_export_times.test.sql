begin;
select no_plan();

-- The evaluations export says when each evaluation was first submitted and when it last changed.
select tests.reset_app();
select tests.create_user('qm_one', 'queue_manager');
select tests.create_user('pan_one', 'panelist');
select tests.create_user('boss', 'admin');
select tests.add_candidate(1);
select tests.login_as('qm_one');
select public.check_in(tests.candidate_id(1));
select public.send_in(tests.candidate_id(1), tests.panel_id('Panel 1'));
select tests.login_as('pan_one');
select public.submit_evaluation(tests.interview_id(1), '{"communication": 3}', 'maybe', '');
select tests.as_postgres();
update public.evaluations set submitted_at = '2026-09-26T10:00:00Z', updated_at = '2026-09-26T10:00:00Z';
select tests.login_as('pan_one');
select public.submit_evaluation(tests.interview_id(1), '{"communication": 4}', 'yes', 'changed my mind');

select tests.login_as('boss');
select is((public.evaluations_export() -> 0 ->> 'submitted_at')::timestamptz, '2026-09-26T10:00:00Z'::timestamptz,
          'the export keeps the first submission time');
select ok((public.evaluations_export() -> 0 ->> 'updated_at')::timestamptz > '2026-09-26T10:00:00Z'::timestamptz,
          'and gives the time of the last change');

select * from finish();
rollback;
