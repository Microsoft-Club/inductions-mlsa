begin;
select no_plan();

select tests.reset_app();
select tests.create_user('qm_one', 'queue_manager');
select tests.create_user('pan_one', 'panelist');
select tests.create_user('boss', 'admin');
select tests.create_user('seat_three', 'panelist');
select tests.add_candidate(n) from generate_series(1, 4) as n;

select tests.login_as('pan_one');
select throws_ok($$ select public.add_panel() $$, '42501', 'Not allowed', 'panelists cannot add panels');

-- add
select tests.login_as('qm_one');
select isnt(public.add_panel(), null::uuid, 'queue manager adds a panel');
select is((select name from public.panels where not is_default and deleted_at is null), 'Panel 3', 'it is named Panel 3');
select is((select sort_order from public.panels where name = 'Panel 3'), 3, 'sorted after the defaults');
select is(jsonb_array_length(public.board_snapshot() -> 'panels'), 3, 'the board shows three panels');
select throws_ok($$ select public.delete_panel(tests.panel_id('Panel 1')) $$, 'P0001', 'Only an admin can delete Panel 1',
                 'queue manager cannot delete default panels');

-- a busy panel cannot be deleted; a free one returns its lane to the pool
select public.check_in(tests.candidate_id(n)) from generate_series(1, 4) as n;
select public.move_candidate(tests.candidate_id(2), tests.panel_id('Panel 3'), null);
select public.move_candidate(tests.candidate_id(3), tests.panel_id('Panel 3'), null);
select tests.seat('seat_three', 'Panel 3'); -- send in lines people up for an empty panel
select public.send_in(tests.candidate_id(4), tests.panel_id('Panel 3'));
select throws_ok($$ select public.delete_panel(tests.panel_id('Panel 3')) $$, 'P0001', 'Panel 3 has an interview in progress',
                 'busy panels cannot be deleted');
select public.end_interview(tests.interview_id(4));

select tests.login_as('pan_one');
select public.set_my_panel(tests.panel_id('Panel 3'));
select is(public.board_snapshot() -> 'panels' -> 2 -> 'panelists' -> 0 ->> 'display_name', 'Pan One',
          'the panelist shows as present on Panel 3');

select tests.login_as('qm_one');
select lives_ok($$ select public.delete_panel(tests.panel_id('Panel 3')) $$, 'queue manager deletes an added panel');
select is(tests.lane(), array[1, 2, 3], 'lined-up candidates join the end of the pool, in order');
select ok(tests.lanes_are_contiguous(), 'positions contiguous after delete');
select ok((select deleted_at is not null from public.panels where name = 'Panel 3'), 'the panel is soft-deleted');
select is((select count(*)::int from public.interviews where status = 'ended'), 1, 'its past interview is kept');
select is((select current_panel_id from public.profiles where username = 'pan_one'), null::uuid, 'panelists on it are cleared');
select is(jsonb_array_length(public.board_snapshot() -> 'panels'), 2, 'the board hides the deleted panel');
select throws_ok($$ select public.reopen_interview(tests.interview_id(4)) $$, 'P0001', 'Panel not found',
                 'an interview on a deleted panel cannot be reopened');

select public.add_panel();
select is((select count(*)::int from public.panels where name = 'Panel 4'), 1, 'numbering continues after a deleted panel');
select throws_ok(
  format('select public.send_in(tests.candidate_id(1), %L)', (select id from public.panels where name = 'Panel 3')),
  'P0001', 'Panel not found', 'nobody can be sent to a deleted panel');

-- admins can delete default panels
select tests.login_as('boss');
select public.set_my_panel(tests.panel_id('Panel 2'));
select lives_ok($$ select public.delete_panel(tests.panel_id('Panel 2')) $$, 'admin deletes Panel 2');
select is((select current_panel_id from public.profiles where username = 'boss'), null::uuid, 'people present are cleared');

select tests.login_as('pan_one');
select throws_ok($$ select public.set_my_panel(gen_random_uuid()) $$, 'P0001', 'Panel not found', 'cannot join an unknown panel');
select lives_ok($$ select public.set_my_panel(null) $$, 'leaving all panels is allowed');

select * from finish();
rollback;
