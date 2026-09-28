begin;
select no_plan();

-- Send in to a panel nobody is sitting in lines the person up at the front of that panel instead of
-- starting an interview with no one there. With anyone sitting there, send in works as before.
select tests.reset_app();
select tests.create_user('qm_one', 'queue_manager');
select tests.create_user('boss', 'admin');
select tests.create_user('pan_one', 'panelist');
select tests.add_candidate(n) from generate_series(1, 4) as n;

select tests.login_as('qm_one');
select public.check_in(tests.candidate_id(n)) from generate_series(1, 4) as n;
select public.move_candidate(tests.candidate_id(3), tests.panel_id('Panel 1'), null);

select is(public.send_in(tests.candidate_id(1), tests.panel_id('Panel 1')), null::uuid, 'send in to an empty panel starts no interview');
select is(tests.status(1), 'waiting', '#1 is still waiting');
select is(tests.lane('Panel 1'), array[1, 3], '#1 is lined up at the front of Panel 1');
select is(tests.lane(), array[2, 4], '#1 left the pool');
select is((select count(*)::int from public.interviews), 0, 'no interview was created');

select tests.login_as('pan_one');
select public.set_my_panel(tests.panel_id('Panel 1'));
select tests.login_as('qm_one');
select isnt(public.send_in(tests.candidate_id(1), tests.panel_id('Panel 1')), null::uuid, 'with a panelist sitting there, send in starts the interview');
select is(tests.status(1), 'interviewing', '#1 is being interviewed');
select is(tests.lane('Panel 1'), array[3], 'Panel 1''s lane closed up');

select tests.login_as('boss');
select public.set_my_panel(tests.panel_id('Panel 2'));
select tests.login_as('qm_one');
select isnt(public.send_in(tests.candidate_id(2), tests.panel_id('Panel 2')), null::uuid, 'an admin sitting in the panel counts as someone there');

select tests.login_as('boss');
select public.set_my_panel(null);
select tests.login_as('qm_one');
select public.end_interview(tests.interview_id(2));
select is(public.send_in(tests.candidate_id(4), tests.panel_id('Panel 2')), null::uuid, 'once everyone has left, send in lines people up again');
select is(tests.lane('Panel 2'), array[4], '#4 is lined up for Panel 2');

select throws_ok($$ select public.send_in(tests.candidate_id(3), tests.panel_id('Panel 1')) $$, 'P0001', 'Panel 1 is busy', 'a busy panel is still refused');

select * from finish();
rollback;
