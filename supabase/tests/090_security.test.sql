begin;
select no_plan();

select results_eq(
  $$ select p.proname::text collate "C" from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
      order by 1 $$,
  $$ values ('display_snapshot'::text collate "C"), ('published_results'), ('server_now') $$,
  'anonymous visitors can call only the projector, results and clock functions');

select results_eq(
  $$ select p.proname::text collate "C" from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
      order by 1 $$,
  $$ values ('add_panel'::text collate "C"), ('authorize_photo_purge'), ('authorize_photo_upload'),
            ('authorize_photo_view'), ('board_snapshot'), ('candidate_record'), ('check_in'), ('clear_photos'),
            ('delete_panel'), ('dismiss_form_warning'), ('display_snapshot'), ('end_interview'), ('evaluation_count'), ('evaluations_export'),
            ('get_display_key'), ('has_role'), ('import_candidates'), ('interview_messages'),
            ('move_candidate'), ('photo_count'), ('photo_queue'), ('post_message'), ('published_results'),
            ('record_photo'), ('regenerate_display_key'), ('remove_from_panel'), ('reopen_interview'), ('results_table'), ('send_in'),
            ('server_now'), ('set_decision'), ('set_my_panel'), ('set_results_published'), ('skip_candidate'),
            ('submit_evaluation'), ('undo_check_in'), ('undo_send_in'), ('update_settings') $$,
  'signed-in staff can call only the client functions (role checks happen inside each one)');

select is((select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity), 0,
          'every public table has row level security enabled');

select * from finish();
rollback;
