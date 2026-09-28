begin;
select no_plan();

-- Candidate photos: the photographer role, who may take and see which photo, and the records the
-- photo API keeps in step with the R2 bucket.
select tests.reset_app();
select tests.create_user('boss', 'admin');
select tests.create_user('queue', 'queue_manager');
select tests.create_user('pan', 'panelist');
select tests.create_user('snap', 'photographer');
select tests.add_candidate(1, 'Ali Khan');
select tests.add_candidate(2, 'Sara Ahmed');
select tests.add_candidate(3, 'Bilal Raza');

-- #1 waits in the pool, #2 is lined up for Panel 1 (still waiting), #3 has not checked in.
-- Someone sits in each panel people are sent into (send in lines people up for an empty panel).
select tests.create_user('seat_two', 'panelist');
select tests.seat('seat_two', 'Panel 2');
select tests.login_as('queue');
select public.check_in(tests.candidate_id(1));
select public.check_in(tests.candidate_id(2));
select public.move_candidate(tests.candidate_id(2), tests.panel_id('Panel 1'), null);

select tests.as_postgres();
select set_config('tests.key1',
  (select induction_id::text || '/' || id::text || '.jpg' from public.candidates where id = tests.candidate_id(1)), true);
select set_config('tests.updated1',
  (select updated_at::text from public.candidates where id = tests.candidate_id(1)), true);

-- The photographer reads their own profile and nothing else.
select tests.login_as('snap');
select is((select count(*)::int from public.profiles), 1, 'a photographer reads only their own profile');
select is((select role::text from public.profiles), 'photographer', '... which says they are a photographer');
select is((select count(*)::int from public.candidates), 0, 'a photographer cannot read the candidates table');
select is((select count(*)::int from public.queue_entries), 0, '... nor the queue');
select is((select count(*)::int from public.interviews), 0, '... nor the interviews');
select throws_ok($$ select public.board_snapshot() $$, '42501', 'Not allowed', '... nor the queue board');
select throws_ok($$ select public.photo_count() $$, '42501', 'Not allowed', 'only admins count photos');

select tests.as_postgres();
update public.profiles set is_active = false where username = 'snap';
select tests.login_as('snap');
select is((select count(*)::int from public.profiles), 0, 'a disabled photographer cannot even read their own profile');
select tests.as_postgres();
update public.profiles set is_active = true where username = 'snap';

-- The photographer's list: everyone waiting, in the pool or lined up, with number, name and times only.
select tests.login_as('snap');
select is((select array_agg((e ->> 'number')::int order by (e ->> 'number')::int) from jsonb_array_elements(public.photo_queue()) e),
          array[1, 2], 'the photo queue lists everyone waiting: the pool and people lined up for a panel');
select is((select array_agg(k order by k) from jsonb_object_keys(public.photo_queue() -> 0) k),
          array['candidate_id', 'checked_in_at', 'name', 'number', 'photo_taken_at'],
          '... with number, name, check-in time and photo time only');
select tests.login_as('boss');
select lives_ok($$ select public.photo_queue() $$, 'admins can open the photo queue too');
select tests.login_as('queue');
select throws_ok($$ select public.photo_queue() $$, '42501', 'Not allowed', 'the queue manager has no photo queue');
select tests.login_as('pan');
select throws_ok($$ select public.photo_queue() $$, '42501', 'Not allowed', '... nor do panelists');

-- Who may take a photo of whom.
select tests.login_as('snap');
select is(public.authorize_photo_upload(tests.candidate_id(1)), current_setting('tests.key1'),
          'a photographer may photograph someone waiting in the pool; the file key is <induction>/<candidate>.jpg');
select lives_ok($$ select public.authorize_photo_upload(tests.candidate_id(2)) $$, '... and someone lined up for a panel');
select throws_ok($$ select public.authorize_photo_upload(tests.candidate_id(3)) $$, 'P0001', 'Candidate #3 is not waiting',
                 '... but not someone who has not checked in');
select throws_ok($$ select public.authorize_photo_upload('00000000-0000-0000-0000-000000000000') $$, 'P0001', 'Candidate not found',
                 'an unknown candidate is refused');
select tests.login_as('queue');
select lives_ok($$ select public.authorize_photo_upload(tests.candidate_id(3)) $$, 'the queue manager may photograph anyone in the induction');
select tests.login_as('boss');
select lives_ok($$ select public.authorize_photo_upload(tests.candidate_id(3)) $$, '... and so may an admin');
select tests.login_as('pan');
select throws_ok($$ select public.authorize_photo_upload(tests.candidate_id(1)) $$, '42501', 'Not allowed', 'panelists do not take photos');
select throws_ok($$ select public.record_photo(tests.candidate_id(1)) $$, '42501', 'Not allowed', '... nor record them');

-- Recording a photo.
select tests.as_postgres();
select set_config('tests.board_msgs',
  (select count(*)::text from realtime.messages where topic = 'board' and event = 'changed'), true);
select tests.login_as('snap');
select isnt(public.record_photo(tests.candidate_id(1)), null, 'recording a photo returns its time');
select tests.as_postgres();
select ok((select photo_taken_at is not null and photo_taken_by = tests.user_id('snap')
             from public.candidates where id = tests.candidate_id(1)),
          'the candidate now has a photo, taken by the photographer');
select is((select updated_at::text from public.candidates where id = tests.candidate_id(1)), current_setting('tests.updated1'),
          'a photo does not count as a change to the application');
select ok((select count(*) from realtime.messages where topic = 'board' and event = 'changed')
          > current_setting('tests.board_msgs')::bigint,
          'recording a photo tells the staff board');

select tests.login_as('snap');
select isnt((select e ->> 'photo_taken_at' from jsonb_array_elements(public.photo_queue()) e where (e ->> 'number')::int = 1), null,
            'the photo queue shows who has a photo');
select tests.login_as('queue');
select is((select (e ->> 'has_photo')::boolean from jsonb_array_elements(public.board_snapshot() -> 'pool') e where (e ->> 'number')::int = 1),
          true, 'the queue board marks people who have a photo');
select is((select (e ->> 'has_photo')::boolean from jsonb_array_elements(public.board_snapshot() -> 'panels' -> 0 -> 'lane') e
            where (e ->> 'number')::int = 2),
          false, '... and people who have none, in a panel''s line too');

-- Who may see a photo.
select tests.login_as('pan');
select is(public.authorize_photo_view(tests.candidate_id(1)), current_setting('tests.key1'), 'panelists may see photos');
select is(public.authorize_photo_view(tests.candidate_id(2)), null, '... and get nothing for someone without a photo');
select is(public.authorize_photo_view('00000000-0000-0000-0000-000000000000'), null, '... or for an unknown candidate');
select tests.login_as('queue');
select is(public.authorize_photo_view(tests.candidate_id(1)), current_setting('tests.key1'), 'the queue manager may see photos');
select tests.login_as('snap');
select is(public.authorize_photo_view(tests.candidate_id(1)), current_setting('tests.key1'),
          'the photographer may see the photo of someone waiting');
select throws_ok($$ select public.authorize_photo_view(tests.candidate_id(3)) $$, '42501', 'Not allowed',
                 'the photographer cannot ask about someone who has not checked in');

-- #1 is sent in while the photographer is still saving: the photo counts, a new one does not start.
select tests.login_as('queue');
select public.send_in(tests.candidate_id(1), tests.panel_id('Panel 2'));
select tests.login_as('snap');
select lives_ok($$ select public.record_photo(tests.candidate_id(1)) $$,
                'a photo finished just after the candidate was sent in still counts');
select throws_ok($$ select public.authorize_photo_upload(tests.candidate_id(1)) $$, 'P0001', 'Candidate #1 is not waiting',
                 '... but a new photo of someone interviewing is refused');
select throws_ok($$ select public.authorize_photo_view(tests.candidate_id(1)) $$, '42501', 'Not allowed',
                 'the photographer cannot see the photo of someone who has gone in');
select is((select count(*)::int from jsonb_array_elements(public.photo_queue()) e where (e ->> 'number')::int = 1), 0,
          '... and they leave the photo queue');
select tests.login_as('pan');
select is(public.authorize_photo_view(tests.candidate_id(1)), current_setting('tests.key1'), 'panelists still see it');

-- Deleting every photo is for admins only, and clearing twice is harmless.
select tests.login_as('queue');
select throws_ok($$ select public.authorize_photo_purge() $$, '42501', 'Not allowed', 'only admins may delete all photos');
select throws_ok($$ select public.clear_photos() $$, '42501', 'Not allowed', '... or clear the photo records');
select tests.login_as('boss');
select is(public.photo_count(), 1, 'admins see how many photos are stored');
select lives_ok($$ select public.authorize_photo_purge() $$, 'admins may delete all photos');
select tests.as_postgres();
select set_config('tests.board_msgs',
  (select count(*)::text from realtime.messages where topic = 'board' and event = 'changed'), true);
select tests.login_as('boss');
select is(public.clear_photos(), 1, 'clearing reports how many records it cleared');
select is(public.photo_count(), 0, '... and none are left');
select is(public.clear_photos(), 0, 'clearing again is harmless');
select tests.as_postgres();
select ok((select count(*) from realtime.messages where topic = 'board' and event = 'changed')
          > current_setting('tests.board_msgs')::bigint,
          'clearing photos tells the staff board');

-- Live updates: photographers hear the board's "changed" signal (a timestamp only), nothing else.
select ok(exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages'
                   and policyname = 'staff receive board broadcasts' and qual like '%photographer%'),
          'photographers receive the board''s "changed" signal');
select ok(not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages'
                       and policyname = 'panelists receive interview broadcasts' and qual like '%photographer%'),
          '... but no interview broadcasts');

select * from finish();
rollback;
