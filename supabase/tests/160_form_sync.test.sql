begin;
select no_plan();

-- Google Form sync: the form-sync edge function sends each new response (as the service role) to
-- sync_form_response, which imports it with the CSV import's rules. Anything the CSV import would
-- flag is kept as a warning on the queue board until a queue manager dismisses it.
select tests.reset_app();
select tests.create_user('qm_one', 'queue_manager');
select tests.create_user('boss', 'admin');
select tests.create_user('pan_one', 'panelist');

-- Only the edge function (service role) may send responses or report problems.
select tests.login_as('qm_one');
select throws_ok($$ select public.sync_form_response(tests.import_row('2023001', 'Ayesha', '2026-09-20T10:00:00+05:00')) $$,
                 '42501', null, 'staff cannot call sync_form_response');
select throws_ok($$ select public.note_form_problem('x') $$, '42501', null, 'staff cannot call note_form_problem');
select tests.logout();
select throws_ok($$ select public.sync_form_response(tests.import_row('2023001', 'Ayesha', '2026-09-20T10:00:00+05:00')) $$,
                 '42501', null, 'anonymous visitors cannot call sync_form_response');

select tests.as_service_role();
select throws_ok($$ select public.sync_form_response('[]'::jsonb) $$, 'P0001', 'A form response must be one row',
                 'rejects anything but one row');

select set_config('tests.board_msgs',
  (select count(*)::text from realtime.messages where topic = 'board' and event = 'changed'), true);
select is(public.sync_form_response(tests.import_row('2023001', 'Ayesha', '2026-09-20T10:00:00+05:00', 'ayesha@example.test')),
          '{"added": 1, "updated": 0, "flagged": []}'::jsonb, 'a new response adds a candidate');
select tests.as_postgres();
select ok((select count(*) from realtime.messages where topic = 'board' and event = 'changed')
          > current_setting('tests.board_msgs')::bigint, 'and tells the board');
select tests.as_service_role();
select is(public.sync_form_response(tests.import_row('2023002', 'Bilal', '2026-09-20T10:05:00+05:00')) -> 'added',
          '1'::jsonb, 'the next response is added too');
select tests.as_postgres();
select is((select array_agg(full_name order by number) from public.candidates), array['Ayesha', 'Bilal'],
          'numbered in the order they arrive');
select is((select count(*)::int from public.form_warnings), 0, 'clean responses leave no warnings');

-- The same response again (e.g. the script retried) changes nothing and warns about nothing.
select tests.as_service_role();
select is(public.sync_form_response(tests.import_row('2023001', 'Ayesha', '2026-09-20T10:00:00+05:00', 'ayesha@example.test')),
          '{"added": 0, "updated": 0, "flagged": []}'::jsonb, 'a repeated response is a no-op');

-- Another response for a reg number already on the list replaces the details, keeps the number,
-- status and queue place, and says so.
select tests.login_as('qm_one');
select public.check_in(tests.candidate_id(1));
select tests.as_service_role();
select is(public.sync_form_response(tests.import_row(' 2023 001 ', 'Ayesha Khan', '2026-09-20T11:00:00+05:00', 'ayesha@example.test')) -> 'flagged',
          '[{"reg_number": "2023001", "name": "Ayesha Khan",
             "reason": "Another response came in for this reg number; kept the latest answers (earlier name: Ayesha)"}]'::jsonb,
          'a second response for a reg number is flagged with the earlier name');
select tests.as_postgres();
select is((select full_name from public.candidates where number = 1), 'Ayesha Khan', 'details updated');
select is(tests.status(1), 'waiting', 'status untouched');
select is(tests.lane(), array[1], 'queue place untouched');
select is((select submitted_at from public.candidates where number = 1), '2026-09-20T10:00:00+05:00'::timestamptz,
          'the earliest submission time is kept');

select tests.as_service_role();
select is(public.sync_form_response(tests.import_row('2023002', 'Bilal', '2026-09-20T12:00:00+05:00', 'bilal@example.test')) -> 'flagged',
          '[{"reg_number": "2023002", "name": "Bilal",
             "reason": "Another response came in for this reg number; kept the latest answers"}]'::jsonb,
          'the earlier name is left out when it did not change');

-- The CSV import's own checks: a missing reg number and a likely reg-number typo.
select is(public.sync_form_response(tests.import_row('', 'No Reg', '2026-09-20T13:00:00+05:00')),
          '{"added": 0, "updated": 0, "flagged": [{"reg_number": "", "name": "No Reg", "reason": "Missing registration number; row skipped"}]}'::jsonb,
          'a response without a reg number is skipped and flagged');
select is(public.sync_form_response(tests.import_row('2023099', 'Ayesha K', '2026-09-20T13:05:00+05:00', 'AYESHA@example.test')),
          '{"added": 1, "updated": 0, "flagged": [{"reg_number": "2023099", "name": "Ayesha K", "reason": "Possible reg number typo; email matches #1"}]}'::jsonb,
          'a new reg number with a known email is added and flagged');

-- The same warning is kept once while nobody has dismissed it.
select public.sync_form_response(tests.import_row('', 'No Reg', '2026-09-20T13:10:00+05:00'));
select tests.as_postgres();
select is((select count(*)::int from public.form_warnings where reason like 'Missing registration number%'), 1,
          'an identical warning is not stored twice');

-- Problems the edge function finds before a row can be read (e.g. the form's questions changed).
select tests.as_service_role();
select public.note_form_problem('The form''s questions changed');
select public.note_form_problem('The form''s questions changed');
select tests.as_postgres();
select is((select count(*)::int from public.form_warnings where reason = 'The form''s questions changed'), 1,
          'a reported problem is stored once');
select tests.as_service_role();
select throws_ok($$ select public.note_form_problem('  ') $$, 'P0001', 'A problem needs a description',
                 'an empty problem is refused');

-- The queue board shows the warnings to queue managers and admins, newest first.
select tests.login_as('qm_one');
select is((select array_agg(w ->> 'reason') from jsonb_array_elements(public.board_snapshot() -> 'form_warnings') as w),
          array['The form''s questions changed',
                'Possible reg number typo; email matches #1',
                'Missing registration number; row skipped',
                'Another response came in for this reg number; kept the latest answers',
                'Another response came in for this reg number; kept the latest answers (earlier name: Ayesha)'],
          'queue managers see every warning, newest first');
select is((select array_agg(k order by k) from jsonb_object_keys(public.board_snapshot() -> 'form_warnings' -> 0) as k),
          array['created_at', 'id', 'name', 'reason', 'reg_number'], 'each warning has its fields');
select tests.login_as('boss');
select is(jsonb_array_length(public.board_snapshot() -> 'form_warnings'), 5, 'admins see them too');
select tests.login_as('pan_one');
select is(public.board_snapshot() -> 'form_warnings', '[]'::jsonb, 'panelists do not');

-- Dismissing.
select tests.as_postgres();
select set_config('tests.problem_id',
  (select id::text from public.form_warnings where reason = 'The form''s questions changed'), true);
select tests.login_as('pan_one');
select throws_ok($$ select public.dismiss_form_warning(current_setting('tests.problem_id')::uuid) $$,
                 '42501', 'Not allowed', 'panelists cannot dismiss warnings');
select tests.as_postgres();
select set_config('tests.board_msgs',
  (select count(*)::text from realtime.messages where topic = 'board' and event = 'changed'), true);
select tests.login_as('qm_one');
select public.dismiss_form_warning(current_setting('tests.problem_id')::uuid);
select is(jsonb_array_length(public.board_snapshot() -> 'form_warnings'), 4, 'a dismissed warning leaves the board');
select tests.as_postgres();
select ok((select count(*) from realtime.messages where topic = 'board' and event = 'changed')
          > current_setting('tests.board_msgs')::bigint, 'dismissing tells the board');
select is((select dismissed_by from public.form_warnings where id = current_setting('tests.problem_id')::uuid),
          tests.user_id('qm_one'), 'who dismissed it is recorded');
select tests.login_as('qm_one');
select lives_ok($$ select public.dismiss_form_warning(current_setting('tests.problem_id')::uuid) $$,
                'dismissing twice is harmless');

-- Once dismissed, the same problem can be reported again.
select tests.as_service_role();
select public.note_form_problem('The form''s questions changed');
select tests.login_as('qm_one');
select is(jsonb_array_length(public.board_snapshot() -> 'form_warnings'), 5, 'a problem that happens again shows again');

-- Staff can't read the table directly; only through the board.
select throws_ok($$ select count(*) from public.form_warnings $$, '42501', null, 'staff cannot read form_warnings directly');

-- The CSV import still shows its flags in the dialog only.
select tests.as_postgres();
select set_config('tests.warning_count', (select count(*)::text from public.form_warnings), true);
select tests.login_as('qm_one');
select is(jsonb_array_length(public.import_candidates(jsonb_build_array(
            tests.import_row('', 'CSV No Reg', '2026-09-20T14:00:00+05:00'))) -> 'flagged'), 1,
          'the CSV import still returns its flags');
select tests.as_postgres();
select is((select count(*)::text from public.form_warnings), current_setting('tests.warning_count'),
          'but does not store them as board warnings');

-- The database itself keeps one open copy of a warning, even when two responses arrive at once.
select lives_ok($$ insert into public.form_warnings (induction_id, reason) values (public.active_induction_id(), 'Twice') $$,
                'an open warning can be stored');
select throws_ok($$ insert into public.form_warnings (induction_id, reason) values (public.active_induction_id(), 'Twice') $$,
                 '23505', null, 'a second open copy is refused by the database');

-- Dismissing reaches only the active induction's warnings.
select set_config('tests.old_warning', (select id::text from public.form_warnings where reason = 'Twice'), true);
select public.create_induction('Next Induction');
select tests.login_as('qm_one');
select public.dismiss_form_warning(current_setting('tests.old_warning')::uuid);
select tests.as_postgres();
select is((select dismissed_at from public.form_warnings where id = current_setting('tests.old_warning')::uuid), null::timestamptz,
          'a warning from another induction is not dismissed');

-- Without an active induction there is nowhere to put a response.
update public.inductions set is_active = false;
select tests.as_service_role();
select throws_ok($$ select public.sync_form_response(tests.import_row('2023500', 'Late', '2026-09-20T15:00:00+05:00')) $$,
                 'P0001', 'No active induction', 'responses need an active induction');
select throws_ok($$ select public.note_form_problem('x') $$, 'P0001', 'No active induction',
                 'so do reported problems');

select * from finish();
rollback;
