begin;
select no_plan();

-- After End, a panel is wrapping up until one of its panelists says it is ready for the next person.
-- Ready unlocks 15 seconds after the interview ended, so End then Ready can't be pressed by reflex.
select tests.reset_app();
select tests.create_user('qm_one', 'queue_manager');
select tests.create_user('boss', 'admin');
select tests.create_user('pan_in', 'panelist');
select tests.create_user('pan_other', 'panelist');
select tests.add_candidate(n) from generate_series(1, 3) as n;
select tests.seat('pan_in', 'Panel 1');
select tests.seat('pan_other', 'Panel 2');

create function pg_temp.last_ended(p_panel text) returns jsonb language sql as $$
  select p -> 'last_ended'
    from jsonb_array_elements(public.board_snapshot() -> 'panels') as p
   where p ->> 'name' = p_panel
$$;
-- Pretends the interview ended this many seconds ago.
create function pg_temp.ended_ago(p_number int, p_seconds int) returns void language sql as $$
  update public.interviews set ended_at = clock_timestamp() - make_interval(secs => p_seconds)
   where id = tests.interview_id(p_number)
$$;

select tests.login_as('qm_one');
select public.check_in(tests.candidate_id(n)) from generate_series(1, 3) as n;
select public.send_in(tests.candidate_id(1), tests.panel_id('Panel 1'));
select tests.login_as('pan_in');
select public.end_interview(tests.interview_id(1));

select is(pg_temp.last_ended('Panel 1') -> 'ready_at', 'null'::jsonb, 'a panel that just ended an interview is not ready yet');
select throws_ok(format('select public.mark_panel_ready(%L)', tests.interview_id(1)), 'P0001',
  'Ready unlocks 15 seconds after the interview ends', 'Ready is refused in the first 15 seconds');

select tests.as_postgres();
select pg_temp.ended_ago(1, 16);

select tests.login_as('pan_other');
select throws_ok(format('select public.mark_panel_ready(%L)', tests.interview_id(1)), 'P0001',
  'Only panelists sitting in Panel 1 can say it is ready', 'a panelist sitting in another panel cannot say it is ready');
select tests.login_as('qm_one');
select throws_ok(format('select public.mark_panel_ready(%L)', tests.interview_id(1)), '42501', 'Not allowed',
  'the queue manager does not say a panel is ready (they can send in anyway)');

select tests.login_as('pan_in');
select lives_ok(format('select public.mark_panel_ready(%L)', tests.interview_id(1)), 'after 15 seconds its panelist can say it is ready');
select isnt(pg_temp.last_ended('Panel 1') -> 'ready_at', 'null'::jsonb, 'the board shows when the panel became ready');
select is((select ready_by from public.interviews where id = tests.interview_id(1)), tests.user_id('pan_in'), 'and who said so');
select lives_ok(format('select public.mark_panel_ready(%L)', tests.interview_id(1)), 'pressing Ready again is harmless');

-- Reopen puts the panel back in the interview; the next End needs a fresh Ready.
select tests.login_as('qm_one');
select public.reopen_interview(tests.interview_id(1));
select is((select ready_at from public.interviews where id = tests.interview_id(1)), null, 'reopening clears ready');
select public.end_interview(tests.interview_id(1));
select is(pg_temp.last_ended('Panel 1') -> 'ready_at', 'null'::jsonb, 'after ending again the panel is wrapping up');

-- Only the panel's latest interview can be marked ready, and only once it has ended.
select public.send_in(tests.candidate_id(2), tests.panel_id('Panel 1'));
select tests.login_as('pan_in');
select throws_ok(format('select public.mark_panel_ready(%L)', tests.interview_id(1)), 'P0001',
  'This is no longer Panel 1''s latest interview', 'an older interview cannot be marked ready');
select throws_ok(format('select public.mark_panel_ready(%L)', tests.interview_id(2)), 'P0001',
  'The interview has not ended', 'an interview in progress cannot be marked ready');

-- Admins can say any panel is ready.
select public.end_interview(tests.interview_id(2));
select tests.as_postgres();
select pg_temp.ended_ago(2, 20);
select tests.login_as('boss');
select lives_ok(format('select public.mark_panel_ready(%L)', tests.interview_id(2)), 'an admin can say a panel is ready');

select * from finish();
rollback;
