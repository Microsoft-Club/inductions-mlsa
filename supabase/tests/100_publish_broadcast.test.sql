begin;
select no_plan();

-- Publishing or unpublishing results changes what panelists may do (evaluations lock), so every
-- staff screen must hear about it.
select tests.reset_app();
select tests.create_user('boss', 'admin');
select tests.create_user('pan_one', 'panelist');

select set_config('tests.board_msgs',
  (select count(*)::text from realtime.messages where topic = 'board' and event = 'changed'), true);
select tests.login_as('boss');
select public.set_results_published(true);
select tests.as_postgres();
select ok((select count(*) from realtime.messages where topic = 'board' and event = 'changed')
          > current_setting('tests.board_msgs')::bigint,
          'publishing results tells the staff board');

select tests.login_as('pan_one');
select is((public.board_snapshot() -> 'induction' ->> 'results_published')::boolean, true,
          'panelists see from the board that results are published');

select tests.as_postgres();
select set_config('tests.board_msgs',
  (select count(*)::text from realtime.messages where topic = 'board' and event = 'changed'), true);
select tests.login_as('boss');
select public.set_results_published(false);
select tests.as_postgres();
select ok((select count(*) from realtime.messages where topic = 'board' and event = 'changed')
          > current_setting('tests.board_msgs')::bigint,
          'unpublishing results tells the staff board too');

select * from finish();
rollback;
