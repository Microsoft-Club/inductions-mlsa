begin;
select no_plan();

select tests.reset_app();
select tests.create_user('qm_one', 'queue_manager');
select tests.create_user('pan_one', 'panelist');
select tests.add_candidate(n) from generate_series(1, 5) as n;

-- Someone sits in each panel people are sent into (send in lines people up for an empty panel).
select tests.create_user('seat_one', 'panelist');
select tests.create_user('seat_two', 'panelist');
select tests.seat('seat_one', 'Panel 1');
select tests.seat('seat_two', 'Panel 2');
select tests.login_as('qm_one');
select public.check_in(tests.candidate_id(n)) from generate_series(1, 4) as n;

-- send in
select isnt(public.send_in(tests.candidate_id(1), tests.panel_id('Panel 1')), null::uuid, 'send in returns the interview id');
select is(tests.status(1), 'interviewing', '#1 is interviewing');
select is(tests.lane(), array[2, 3, 4], '#1 left the pool and the pool closed up');
select ok((select status = 'in_progress' and started_at is not null from public.interviews where id = tests.interview_id(1)),
          'interview started with a server timestamp');
select throws_ok($$ select public.send_in(tests.candidate_id(2), tests.panel_id('Panel 1')) $$, 'P0001', 'Panel 1 is busy', 'a busy panel is refused');
select throws_ok($$ select public.send_in(tests.candidate_id(5), tests.panel_id('Panel 2')) $$, 'P0001', 'Candidate #5 is not waiting', 'registered candidates cannot be sent in');
select throws_ok($$ select public.send_in(tests.candidate_id(1), tests.panel_id('Panel 2')) $$, 'P0001', 'Candidate #1 is not waiting', 'the same person cannot be sent in twice');

select tests.login_as('pan_one');
select throws_ok($$ select public.send_in(tests.candidate_id(2), tests.panel_id('Panel 2')) $$, '42501', 'Not allowed', 'panelists cannot send people in');

-- undo send-in: back to the top of that panel's lane
select tests.login_as('qm_one');
select public.move_candidate(tests.candidate_id(2), tests.panel_id('Panel 1'), null);
select public.undo_send_in(tests.interview_id(1));
select is(tests.status(1), 'waiting', 'undo send-in returns #1 to waiting');
select is(tests.lane('Panel 1'), array[1, 2], '#1 is back at the top of Panel 1''s lane');
select is((select status::text from public.interviews where id = tests.interview_id(1)), 'cancelled', 'the interview is cancelled');
select throws_ok($$ select public.undo_send_in(tests.interview_id(1)) $$, 'P0001', 'Interview is not in progress', 'cannot undo twice');

-- end
select public.send_in(tests.candidate_id(1), tests.panel_id('Panel 1'));
select tests.login_as('pan_one');
select public.set_my_panel(tests.panel_id('Panel 1'));
select lives_ok($$ select public.end_interview(tests.interview_id(1)) $$, 'panelists sitting in the panel can end its interview');
select is(tests.status(1), 'interviewed', '#1 is interviewed');
select ok((select ended_at is not null from public.interviews where id = tests.interview_id(1)), 'end time recorded');
select throws_ok($$ select public.end_interview(tests.interview_id(1)) $$, 'P0001', 'Interview is not in progress', 'cannot end twice');
select throws_ok($$ select public.reopen_interview(tests.interview_id(1)) $$, '42501', 'Not allowed', 'panelists cannot reopen');

-- reopen
select tests.login_as('qm_one');
select public.reopen_interview(tests.interview_id(1));
select is(tests.status(1), 'interviewing', 'reopen resumes the interview');
select ok((select status = 'in_progress' and ended_at is null from public.interviews where id = tests.interview_id(1)),
          'the interview is in progress again');

-- only the latest interview, and only onto a free panel
select public.end_interview(tests.interview_id(1));
select public.send_in(tests.candidate_id(2), tests.panel_id('Panel 1'));
select public.end_interview(tests.interview_id(2));
select throws_ok($$ select public.reopen_interview(tests.interview_id(1)) $$, 'P0001', 'Only the most recent interview can be reopened', 'older interviews stay closed');
select public.send_in(tests.candidate_id(3), tests.panel_id('Panel 1'));
select throws_ok($$ select public.reopen_interview(tests.interview_id(2)) $$, 'P0001', 'Panel 1 is busy', 'cannot reopen onto a busy panel');
select throws_ok($$ select public.reopen_interview(tests.interview_id(3)) $$, 'P0001', 'Interview cannot be reopened', 'an in-progress interview cannot be reopened');

-- the database itself refuses two active interviews on one panel
select tests.as_postgres();
select throws_ok(
  $$ insert into public.interviews (induction_id, candidate_id, panel_id)
     values (public.active_induction_id(), tests.candidate_id(4), tests.panel_id('Panel 1')) $$,
  '23505', null, 'unique index blocks a second active interview on a panel');

select * from finish();
rollback;
