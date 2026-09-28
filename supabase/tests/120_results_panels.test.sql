begin;
select no_plan();

-- The results table says which panel interviewed each candidate; an undone send-in doesn't count.
select tests.reset_app();
select tests.create_user('qm_one', 'queue_manager');
select tests.create_user('boss', 'admin');
select tests.add_candidate(1);
select tests.add_candidate(2);
-- Someone sits in each panel people are sent into (send in lines people up for an empty panel).
select tests.create_user('seat_one', 'panelist');
select tests.create_user('seat_two', 'panelist');
select tests.seat('seat_one', 'Panel 1');
select tests.seat('seat_two', 'Panel 2');
select tests.login_as('qm_one');
select public.check_in(tests.candidate_id(1));
select public.send_in(tests.candidate_id(1), tests.panel_id('Panel 1'));
select public.undo_send_in(tests.interview_id(1));
select public.send_in(tests.candidate_id(1), tests.panel_id('Panel 2'));

select tests.login_as('boss');
select is((select r -> 'panels' from jsonb_array_elements(public.results_table()) r where (r ->> 'number')::int = 1),
          '["Panel 2"]'::jsonb, 'a candidate lists the panel that interviewed them, not one whose send-in was undone');
select is((select r -> 'panels' from jsonb_array_elements(public.results_table()) r where (r ->> 'number')::int = 2),
          '[]'::jsonb, 'a candidate nobody has interviewed lists no panel');

select * from finish();
rollback;
