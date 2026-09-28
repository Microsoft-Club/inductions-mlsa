begin;
select no_plan();

-- Only the panelists sitting in an interview's panel can end it. The queue manager and admins can end
-- any interview (for example one that runs over while its panel forgets to press End).
select tests.reset_app();
select tests.create_user('qm_one', 'queue_manager');
select tests.create_user('boss', 'admin');
select tests.create_user('pan_in', 'panelist');
select tests.create_user('pan_other', 'panelist');
select tests.create_user('pan_none', 'panelist');
select tests.add_candidate(n) from generate_series(1, 4) as n;

select tests.login_as('pan_in');
select public.set_my_panel(tests.panel_id('Panel 1'));
select tests.login_as('pan_other');
select public.set_my_panel(tests.panel_id('Panel 2'));
select tests.login_as('qm_one');
select public.check_in(tests.candidate_id(n)) from generate_series(1, 4) as n;
select public.send_in(tests.candidate_id(1), tests.panel_id('Panel 1'));
select tests.login_as('pan_other');

select throws_ok($$ select public.end_interview(tests.interview_id(1)) $$, 'P0001',
  'Only panelists sitting in Panel 1 can end this interview', 'a panelist sitting in another panel cannot end it');
select tests.login_as('pan_none');
select throws_ok($$ select public.end_interview(tests.interview_id(1)) $$, 'P0001',
  'Only panelists sitting in Panel 1 can end this interview', 'a panelist not sitting in any panel cannot end it');
select is(tests.status(1), 'interviewing', '#1 is still being interviewed');

select tests.login_as('pan_in');
select lives_ok($$ select public.end_interview(tests.interview_id(1)) $$, 'a panelist sitting in that panel can end it');
select is(tests.status(1), 'interviewed', '#1 is interviewed');

select tests.login_as('qm_one');
select public.send_in(tests.candidate_id(2), tests.panel_id('Panel 1'));
select lives_ok($$ select public.end_interview(tests.interview_id(2)) $$, 'the queue manager can end any interview');
select public.send_in(tests.candidate_id(3), tests.panel_id('Panel 2'));
select tests.login_as('boss');
select lives_ok($$ select public.end_interview(tests.interview_id(3)) $$, 'an admin can end any interview, in a panel or not');

-- Moving to another panel moves the right to end with you.
select tests.login_as('qm_one');
select public.send_in(tests.candidate_id(4), tests.panel_id('Panel 2'));
select tests.login_as('pan_in');
select throws_ok($$ select public.end_interview(tests.interview_id(4)) $$, 'P0001',
  'Only panelists sitting in Panel 2 can end this interview', 'Panel 1''s panelist cannot end Panel 2''s interview');
select public.set_my_panel(tests.panel_id('Panel 2'));
select lives_ok($$ select public.end_interview(tests.interview_id(4)) $$, 'after moving to Panel 2 they can end its interview');

select * from finish();
rollback;
