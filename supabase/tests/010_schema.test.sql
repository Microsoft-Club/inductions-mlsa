begin;
select no_plan();

select tests.reset_app();

-- create_induction: one active induction, Panel 1 + Panel 2, ten placeholder criteria
select is((select count(*)::int from public.inductions where is_active), 1, 'exactly one active induction');
select is((select array_agg(name order by sort_order) from public.panels), array['Panel 1', 'Panel 2'], 'Panel 1 and Panel 2 exist');
select ok((select bool_and(is_default) from public.panels), 'both are default panels');
select is((select count(*)::int from public.evaluation_criteria), 10, 'ten placeholder criteria');
select is((select array_agg(key order by sort_order) from public.evaluation_criteria where category = 'team_fit'),
          array['fit_dev', 'fit_logikal', 'fit_lnd', 'fit_marketing', 'fit_brainees'], 'team-fit criteria');
select is((select length(display_key) from public.inductions where is_active), 48, 'projector key is 48 hex chars');

select public.create_induction('Next Year');
select is((select name from public.inductions where is_active), 'Next Year', 'a new induction becomes the active one');
select is((select count(*)::int from public.inductions), 2, 'the old induction is kept');
select tests.reset_app();

-- accounts
select tests.create_user('qm_one', 'queue_manager');
select tests.create_user('pan_one', 'panelist');
select tests.create_user('pan_two', 'panelist');
select tests.create_user('boss', 'admin');
select throws_ok($$ select tests.create_user('Bad Name', 'panelist') $$, '23514', null, 'invalid usernames are rejected');

-- data for the read-policy checks
select tests.add_candidate(1);
select tests.add_candidate(2);
insert into public.interviews (induction_id, candidate_id, panel_id, status)
values (public.active_induction_id(), tests.candidate_id(1), tests.panel_id('Panel 1'), 'ended');
insert into public.messages (interview_id, author_id, body)
select id, tests.user_id('pan_one'), 'hello' from public.interviews;
insert into public.evaluations (interview_id, panelist_id, recommendation)
select id, tests.user_id('pan_one'), 'yes'::public.recommendation from public.interviews
union all
select id, tests.user_id('pan_two'), 'no'::public.recommendation from public.interviews;

-- anonymous visitors (candidates) read nothing
select tests.logout();
select throws_ok($$ select count(*) from public.candidates $$, '42501', null, 'anon cannot read candidates');
select throws_ok($$ select count(*) from public.inductions $$, '42501', null, 'anon cannot read inductions');

-- panelists
select tests.login_as('pan_one');
select is((select count(*)::int from public.candidates), 2, 'panelist reads candidates');
select is((select count(*)::int from public.messages), 1, 'panelist reads chat');
select is((select count(*)::int from public.evaluations), 1, 'panelist reads only their own evaluation');
select throws_ok($$ update public.candidates set full_name = 'x' $$, '42501', null, 'panelist cannot write tables directly');
select throws_ok($$ select display_key from public.inductions $$, '42501', null, 'projector key is hidden from staff');
select is((select name from public.inductions where is_active), 'Test Induction', 'staff read induction settings');

-- queue manager
select tests.login_as('qm_one');
select is((select count(*)::int from public.candidates), 2, 'queue manager reads candidates');
select is((select count(*)::int from public.messages), 0, 'queue manager cannot read chat');
select is((select count(*)::int from public.evaluations), 0, 'queue manager cannot read evaluations');

-- admin
select tests.login_as('boss');
select is((select count(*)::int from public.evaluations), 2, 'admin reads all evaluations');

-- Review focus 1: a disabled account reads nothing
select tests.as_postgres();
update public.profiles set is_active = false where username = 'pan_two';
select tests.login_as('pan_two');
select is((select count(*)::int from public.candidates), 0, 'disabled account reads nothing');

-- an auth user with no profile (e.g. an accidental self-signup) reads nothing
select tests.as_postgres();
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000aa', 'stranger@tests.local');
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-0000000000aa", "role": "authenticated"}', true);
select is((select count(*)::int from public.candidates), 0, 'a user without a profile reads nothing');

select * from finish();
rollback;
