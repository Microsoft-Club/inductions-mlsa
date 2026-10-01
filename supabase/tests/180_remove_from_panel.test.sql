begin;
select no_plan();

-- Admins can take someone out of a panel (panelists often forget to leave when they walk away).
select tests.reset_app();
select tests.create_user('boss', 'admin');
select tests.create_user('qm_one', 'queue_manager');
select tests.create_user('pan_one', 'panelist');
select tests.create_user('pan_two', 'panelist');
select tests.seat('pan_one', 'Panel 1');
select tests.seat('pan_two', 'Panel 1');

select tests.login_as('qm_one');
select throws_ok(format('select public.remove_from_panel(%L)', tests.user_id('pan_one')), '42501', 'Not allowed',
                 'queue managers cannot remove people from panels');
select tests.login_as('pan_two');
select throws_ok(format('select public.remove_from_panel(%L)', tests.user_id('pan_one')), '42501', 'Not allowed',
                 'panelists cannot remove each other');

select tests.as_postgres();
select set_config('tests.board_msgs',
  (select count(*)::text from realtime.messages where topic = 'board' and event = 'changed'), true);
select tests.login_as('boss');
select lives_ok(format('select public.remove_from_panel(%L)', tests.user_id('pan_one')), 'an admin removes someone from a panel');
select is((select array_agg(p ->> 'display_name') from jsonb_array_elements(public.board_snapshot() -> 'panels' -> 0 -> 'panelists') as p),
          array['Pan Two'], 'the board no longer shows them in the panel');
select lives_ok(format('select public.remove_from_panel(%L)', tests.user_id('pan_one')), 'removing someone who is not in a panel is harmless');
select tests.as_postgres();
select is((select current_panel_id from public.profiles where id = tests.user_id('pan_one')), null::uuid, 'their seat is cleared');
select is((select current_panel_id from public.profiles where id = tests.user_id('pan_two')), tests.panel_id('Panel 1'), 'others stay seated');
select ok((select count(*) from realtime.messages where topic = 'board' and event = 'changed')
          > current_setting('tests.board_msgs')::bigint, 'every screen hears about it');

select * from finish();
rollback;
