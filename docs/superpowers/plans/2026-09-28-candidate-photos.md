# Candidate Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new Photographer role photographs every checked-in candidate on a phone before their interview. The queue manager is asked about missing photos at Send in. Panelists and admins see the photo on the candidate card. Photos are stored in a private Cloudflare R2 bucket until an admin deletes them all.

**Architecture:**
- **Database.** One additive migration adds the `photographer` role, two photo fields on `candidates`, and seven photo functions. The functions decide who may take or see which photo.
- **Photo API.** A Cloudflare Pages Function (`functions/api/photos/[[path]].ts`) serves `/api/photos`. It forwards the user's own Supabase token to those functions, then reads or writes R2 through the `PHOTOS` binding. The handler lives in `server/photos/`:
  - the Pages Function calls it with the R2 binding;
  - the Vite dev server calls it with a local folder in place of R2;
  - the tests call it directly.
- **Browser.** The browser shrinks each photo to a ~100 KB JPEG before uploading. It reads photos through the photo API and keeps them in an in-memory cache that is cleared at sign-out.

**Tech Stack:** As before: React 19.3, React Router 8.4, Vite 8.3, Tailwind CSS 4.3, TypeScript 7.0, `@supabase/supabase-js` 2.117, Vitest 5 with jsdom 30 and Testing Library, pgTAP, and Playwright 1.63 (Chromium). Cloudflare Pages Functions and R2 are used through a hand-written minimal interface, so no new packages are needed.

**Spec:** `docs/superpowers/specs/2026-09-27-candidate-photos-design.md` (§2 decisions, §3 access, §4 screens, §6 database, §7 photo API, §8 frontend, §9 local development, §10 edge cases, §11 testing, §12 rollout). Builds on `docs/superpowers/specs/2026-09-25-induction-system-design.md`.

## Global Constraints

- **Additive only.** The migration only adds things (a role value, two nullable columns, one policy, new functions, and one new key in lane JSON). The live site on `main` keeps working before and after it is applied.
- **No new dependencies, no Docker images.** The disk has about 1.6 GB free. Don't enable the local `storage-api` service; photos never touch Supabase Storage.
- **Names (spec §2):**
  - bucket `mlsa-induction-photos`, bound as `PHOTOS`;
  - role value `photographer`, label `Photographer`, home `/photos`;
  - the nav link `Photos` shows for `photographer` and `admin`;
  - file key `<induction_id>/<candidate_id>.jpg`.
- **Environment:** the Pages Function reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, the same variables the build already uses. No new secrets.
- **Photo limits (spec §2, §8):**
  - 800 px on the long side;
  - JPEG quality 0.82, then 0.6 if the result is still too big;
  - `MAX_PHOTO_BYTES = 1_048_576`;
  - the server refuses bodies over that size (413) and anything not starting `FF D8 FF` (415).
- **Caching:** photo responses carry `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`. The browser caches photos only in memory, and the cache is cleared at sign-out.
- **Photos never appear** on the projector (`/display`) or the public page (`/selected`).
- **Exact wording:**
  - "N need photo · M done", "Needs photo", "Done", "Nobody is waiting.", "Everyone waiting has a photo.", "No photos yet.", "Nobody here matches.";
  - "No photo yet" (title), "#12 Ali Khan has no photo yet.", "Take photo", "Send without photo", "Cancel";
  - "Save", "Saving…", "Retake", "Try again", "Retake photo", "Choose a file instead", "Choose a photo file", "No camera available here. Choose a photo file instead.", "This photo couldn't be read. Take it again.";
  - "N photos stored.", "Delete all photos", "Delete all N photos? This can't be undone.", "Deleted N photos.".
- **Tests run against the local stack only.** Never run `db:test`, `db:reset` or any suite against production.
- **Component tests** start with `// @vitest-environment jsdom`. jsdom has no `URL.createObjectURL`, `matchMedia`, `createImageBitmap`, canvas encoding or `mediaDevices`. Stub the first two where needed, and mock `src/photos/shrinkPhoto.ts` wherever a photo is "taken".
- **Integration and E2E tests** need `npm run db:start`, `npm run seed:dev` and `npm run web:env`. E2E starts the dev server itself.
- **Production steps (Task 12) change live systems.** Ask the user before each one.
- **Commits:** `feat(db): …`, `feat(web): …`, `feat(photos): …`, `docs: …`, with no attribution lines.

## Review Focus

These are the failure modes a person on induction day is most likely to hit. A test in the owning task pins each one:

1. **A phone photo far bigger than needed** (12 MP, several MB, stored sideways with an EXIF rotation). It is saved upright at 800 px on the long side and under 1 MB. Pinned in Task 5 (`targetSize` for portrait, landscape and small photos) and Task 10 (a 1600×1200 JPEG comes back 800×600).
2. **The candidate is sent in while the photographer is still capturing or saving.**
   - A photo whose upload was already authorised still counts.
   - Starting a new one shows "Candidate #N is not waiting", and the preview stays on screen.
   - Pinned in Task 1 (database) and Task 6 (the capture view keeps the preview).
3. **Patchy mobile data during Save.** The preview stays with **Try again**, and a second tap saves without taking the photo again. Pinned in Task 6.
4. **Delete all photos is interrupted, or pressed twice.**
   - Files are deleted before records are cleared, and a failed file delete leaves the records.
   - Running it again finishes the job; a second run is harmless.
   - Listing pages stays correct while files are deleted between pages.
   - Pinned in Task 2 (handler) and Task 3 (folder bucket).
5. **Someone calls `/api/photos` directly for a candidate they shouldn't touch.** Examples: a photographer asking about a candidate who isn't waiting, a panelist uploading, a non-admin deleting. They get 403 or 400 and nothing is saved. Pinned in Task 1 (database) and Task 4 (integration through the real handler and database).

---

### Task 1: Database: the photographer role, photo records and photo permissions

**Files:**
- Create: `supabase/migrations/20260927000300_candidate_photos.sql`
- Create: `supabase/tests/130_candidate_photos.test.sql`
- Modify: `supabase/tests/090_security.test.sql` (the list of functions `authenticated` may call)

**Interfaces:**
- Consumes:
  - `require_role(variadic text[])`, `require_active_induction()`, `active_induction_id()`, `current_app_role()`, `has_role(variadic text[])`, `broadcast_board()` and `check_in`/`move_candidate`/`send_in` (Plans 1–3);
  - the pgTAP helpers `tests.reset_app()`, `tests.create_user()`, `tests.login_as()`, `tests.as_postgres()`, `tests.add_candidate()`, `tests.candidate_id()`, `tests.panel_id()`, `tests.user_id()`.
- Produces (every later task relies on these names):
  - enum value `app_role.photographer`;
  - `candidates.photo_taken_at timestamptz null` and `candidates.photo_taken_by uuid null`;
  - the policy `"read own profile"` on `profiles`;
  - photographers are admitted to `board` broadcasts;
  - `lane_json` entries gain `has_photo boolean`;
  - `photo_queue() → jsonb`: an array of `{candidate_id, number, name, checked_in_at, photo_taken_at}`; roles photographer and admin;
  - `authorize_photo_upload(p_candidate_id uuid) → text` (the file key);
  - `record_photo(p_candidate_id uuid) → timestamptz`;
  - `authorize_photo_view(p_candidate_id uuid) → text | null`;
  - `photo_count() → int`;
  - `authorize_photo_purge() → void`;
  - `clear_photos() → int`.

- [ ] **Step 1: Write the failing database test**

`supabase/tests/130_candidate_photos.test.sql`:

```sql
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
```

In `supabase/tests/090_security.test.sql`, replace the whole second `results_eq` (the one about `authenticated`) with:

```sql
select results_eq(
  $$ select p.proname::text collate "C" from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
      order by 1 $$,
  $$ values ('add_panel'::text collate "C"), ('authorize_photo_purge'), ('authorize_photo_upload'),
            ('authorize_photo_view'), ('board_snapshot'), ('candidate_record'), ('check_in'), ('clear_photos'),
            ('delete_panel'), ('display_snapshot'), ('end_interview'), ('evaluation_count'), ('evaluations_export'),
            ('get_display_key'), ('has_role'), ('import_candidates'), ('interview_messages'),
            ('move_candidate'), ('photo_count'), ('photo_queue'), ('post_message'), ('published_results'),
            ('record_photo'), ('regenerate_display_key'), ('reopen_interview'), ('results_table'), ('send_in'),
            ('server_now'), ('set_decision'), ('set_my_panel'), ('set_results_published'), ('skip_candidate'),
            ('submit_evaluation'), ('undo_check_in'), ('undo_send_in'), ('update_settings') $$,
  'signed-in staff can call only the client functions (role checks happen inside each one)');
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run db:test`
Expected:
- `130_candidate_photos.test.sql` fails at its first `tests.create_user(..., 'photographer')` with `invalid input value for enum app_role: "photographer"`.
- `090_security.test.sql` reports `not ok` for the `authenticated` list.
- The run ends with `Result: FAIL`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260927000300_candidate_photos.sql`:

```sql
-- Candidate photos (spec: docs/superpowers/specs/2026-09-27-candidate-photos-design.md).
-- The files live in Cloudflare R2. The database records who has a photo and decides who may take or
-- see one: the photo API (functions/api/photos) calls the authorize_*, record_photo and clear_photos
-- functions below with the signed-in user's own token.

-- Functions compare role::text, so the new value is never needed as an enum literal in this transaction.
alter type public.app_role add value if not exists 'photographer';

-- null = no photo. updated_at is left alone: it tracks the application and the decision.
alter table public.candidates
  add column photo_taken_at timestamptz,
  add column photo_taken_by uuid references public.profiles (id) on delete set null;

-- Every active account can read its own profile (the app learns its role from it). Photographers get
-- nothing else; the staff policy still lets admins, queue managers and panelists read every profile.
create policy "read own profile" on public.profiles for select to authenticated
  using (id = (select auth.uid()) and is_active);

-- The board's "changed" signal carries only a timestamp; the photographer's list reloads on it.
drop policy "staff receive board broadcasts" on realtime.messages;
create policy "staff receive board broadcasts" on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'board'
    and (select public.has_role('admin', 'queue_manager', 'panelist', 'photographer'))
  );

-- The queue board marks who has a photo (the queue manager's camera icon and Send in question).
create or replace function public.lane_json(p_induction_id uuid, p_panel_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'candidate_id', c.id, 'number', c.number, 'name', c.full_name, 'reg_number', c.reg_number,
           'position', q.position, 'skip_count', q.skip_count, 'checked_in_at', c.checked_in_at,
           'has_photo', c.photo_taken_at is not null)
         order by q.position), '[]'::jsonb)
    from public.queue_entries q
    join public.candidates c on c.id = q.candidate_id
   where q.induction_id = p_induction_id and q.panel_id is not distinct from p_panel_id
$$;

-- Where a candidate's photo lives in the bucket.
create function public.photo_key(p_induction_id uuid, p_candidate_id uuid) returns text
language sql immutable set search_path = '' as $$
  select p_induction_id::text || '/' || p_candidate_id::text || '.jpg'
$$;

-- The candidate a photo upload is about, after the checks every upload shares. Queue managers and
-- admins may photograph anyone in the active induction; photographers only people in these statuses.
create function public.photo_candidate(p_candidate_id uuid, p_photographer_statuses text[]) returns public.candidates
language plpgsql stable security definer set search_path = '' as $$
declare
  v_c public.candidates;
begin
  perform public.require_role('admin', 'queue_manager', 'photographer');
  select * into v_c from public.candidates
   where id = p_candidate_id and induction_id = public.require_active_induction();
  if not found then
    raise exception 'Candidate not found';
  end if;
  if public.current_app_role() = 'photographer' and not (v_c.status::text = any (p_photographer_statuses)) then
    raise exception 'Candidate #% is not waiting', v_c.number;
  end if;
  return v_c;
end $$;

-- The photographer's list: everyone waiting (in the pool or lined up), earliest check-in first.
create function public.photo_queue() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_ind uuid;
begin
  perform public.require_role('admin', 'photographer');
  v_ind := public.require_active_induction();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'candidate_id', c.id, 'number', c.number, 'name', c.full_name,
             'checked_in_at', c.checked_in_at, 'photo_taken_at', c.photo_taken_at)
           order by c.checked_in_at, c.number)
      from public.candidates c
     where c.induction_id = v_ind and c.status = 'waiting'), '[]'::jsonb);
end $$;

-- Before a file is saved: may this user photograph this candidate? Returns the file key.
create function public.authorize_photo_upload(p_candidate_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_c public.candidates;
begin
  v_c := public.photo_candidate(p_candidate_id, array['waiting']);
  return public.photo_key(v_c.induction_id, v_c.id);
end $$;

-- After the file is saved. A photographer's photo still counts if the candidate was sent in meanwhile.
create function public.record_photo(p_candidate_id uuid) returns timestamptz
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_c public.candidates;
  v_at timestamptz := clock_timestamp();
begin
  v_c := public.photo_candidate(p_candidate_id, array['waiting', 'interviewing']);
  update public.candidates set photo_taken_at = v_at, photo_taken_by = auth.uid() where id = v_c.id;
  perform public.broadcast_board();
  return v_at;
end $$;

-- May this user see this candidate's photo? The file key, or null when there is no photo.
create function public.authorize_photo_view(p_candidate_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_c public.candidates;
begin
  perform public.require_role('admin', 'queue_manager', 'panelist', 'photographer');
  select * into v_c from public.candidates where id = p_candidate_id;
  -- Photographers see only who is waiting now; asking about anyone else is refused outright.
  if public.current_app_role() = 'photographer'
     and (v_c.id is null or v_c.status is distinct from 'waiting'
          or v_c.induction_id is distinct from public.active_induction_id()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_c.id is null or v_c.photo_taken_at is null then
    return null;
  end if;
  return public.photo_key(v_c.induction_id, v_c.id);
end $$;

-- How many candidates have a photo, across all inductions (the Delete all confirmation).
create function public.photo_count() returns int
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_role('admin');
  return (select count(*)::int from public.candidates where photo_taken_at is not null);
end $$;

-- Before the bucket is emptied: is this an admin?
create function public.authorize_photo_purge() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.require_role('admin');
end $$;

-- After the bucket is emptied: nobody has a photo any more. Returns how many records were cleared.
create function public.clear_photos() returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_count int;
begin
  perform public.require_role('admin');
  update public.candidates set photo_taken_at = null, photo_taken_by = null where photo_taken_at is not null;
  get diagnostics v_count = row_count;
  perform public.broadcast_board();
  return v_count;
end $$;

revoke execute on function public.photo_key(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.photo_candidate(uuid, text[]) from public, anon, authenticated;
revoke execute on function public.photo_queue(), public.authorize_photo_upload(uuid), public.record_photo(uuid),
  public.authorize_photo_view(uuid), public.photo_count(), public.authorize_photo_purge(), public.clear_photos()
  from public, anon;
grant execute on function public.photo_queue(), public.authorize_photo_upload(uuid), public.record_photo(uuid),
  public.authorize_photo_view(uuid), public.photo_count(), public.authorize_photo_purge(), public.clear_photos()
  to authenticated;
```

- [ ] **Step 4: Apply it and run every database test**

Run: `npm run db:reset && npm run db:test && npm run seed:dev`
Expected:
- `Result: PASS`, with every file `ok`, including `130_candidate_photos.test.sql` and `090_security.test.sql`.
- `seed:dev` puts the dev accounts and candidates back.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260927000300_candidate_photos.sql supabase/tests/130_candidate_photos.test.sql supabase/tests/090_security.test.sql
git commit -m "feat(db): photographer role, candidate photo records and who may take or see them"
```

---

### Task 2: The photo API handler

**Files:**
- Create: `server/photos/limits.ts`
- Create: `server/photos/bucket.ts`
- Create: `server/photos/gate.ts`
- Create: `server/photos/handler.ts`
- Create: `tests/unit/photos/handler.test.ts`
- Modify: `tsconfig.json` (`include`)

**Interfaces:**
- Consumes: Task 1's `authorize_photo_upload`, `record_photo`, `authorize_photo_view`, `authorize_photo_purge` and `clear_photos`, called as PostgREST RPCs (`POST <url>/rest/v1/rpc/<fn>`).
- Produces:
  - `PHOTO_LONG_SIDE = 800` and `MAX_PHOTO_BYTES = 1_048_576` (`limits.ts`);
  - `interface PhotoBucket { put(key, value: Uint8Array<ArrayBuffer>, options?); get(key) → {body: ReadableStream} | null; delete(keys: string | string[]); list({limit?, cursor?}) → {objects: {key}[], truncated, cursor?} }` (`bucket.ts`);
  - `type FetchLike = (url: string, init: RequestInit) => Promise<Response>`, `class PhotoError(status, message)`, `interface SupabaseEnv { VITE_SUPABASE_URL; VITE_SUPABASE_ANON_KEY }`, `callRpc<T>(env, token, fn, args, fetchImpl)` (`gate.ts`);
  - `interface PhotoEnv extends SupabaseEnv { PHOTOS: PhotoBucket }` and `handlePhotoRequest(request: Request, env: PhotoEnv, fetchImpl?: FetchLike): Promise<Response>`, which routes `/api/photos` (DELETE) and `/api/photos/<uuid>` (GET, PUT) (`handler.ts`).

- [ ] **Step 1: Write the failing tests**

`tests/unit/photos/handler.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { PhotoBucket } from '../../../server/photos/bucket.ts';
import { handlePhotoRequest, type PhotoEnv } from '../../../server/photos/handler.ts';
import { MAX_PHOTO_BYTES } from '../../../server/photos/limits.ts';

const ID = '11111111-2222-4333-8444-555555555555';
const KEY = `ind-1/${ID}.jpg`;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const TAKEN_AT = '2026-09-27T10:00:00.123456+00:00';

/** An in-memory bucket that keeps a log of what happened, in order. */
function memoryBucket(initial: Array<[string, Uint8Array<ArrayBuffer>]> = []) {
  const files = new Map(initial);
  const log: string[] = [];
  const bucket = {
    put: vi.fn(async (key: string, value: Uint8Array<ArrayBuffer>) => {
      log.push(`put ${key}`);
      files.set(key, value);
    }),
    get: vi.fn(async (key: string) => {
      const value = files.get(key);
      return value ? { body: new Blob([value]).stream() } : null;
    }),
    delete: vi.fn(async (keys: string | string[]) => {
      for (const key of [keys].flat()) {
        log.push(`delete ${key}`);
        files.delete(key);
      }
    }),
    list: vi.fn(async ({ limit = 1000, cursor }: { limit?: number; cursor?: string } = {}) => {
      const keys = [...files.keys()].sort().filter((key) => !cursor || key > cursor);
      const page = keys.slice(0, limit);
      const truncated = keys.length > page.length;
      return { objects: page.map((key) => ({ key })), truncated, cursor: truncated ? page.at(-1) : undefined };
    }),
  } satisfies PhotoBucket;
  return { bucket, files, log };
}

type Reply = { status?: number; body?: unknown };

/** Answers `/rest/v1/rpc/<fn>` like PostgREST from a table of replies, and remembers every call. */
function fakeSupabase(replies: Record<string, Reply>) {
  const calls: Array<{ url: string; fn: string; args: unknown; authorization: string | null; apikey: string | null }> = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    const fn = url.split('/rpc/')[1];
    const headers = new Headers(init.headers);
    calls.push({ url, fn, args: JSON.parse(String(init.body)), authorization: headers.get('Authorization'), apikey: headers.get('apikey') });
    const reply = replies[fn] ?? { status: 404, body: { message: `no fake for ${fn}` } };
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status ?? 200 });
  });
  return { fetchImpl, calls, fns: () => calls.map((c) => c.fn) };
}

const envWith = (bucket: PhotoBucket): PhotoEnv => ({
  PHOTOS: bucket,
  VITE_SUPABASE_URL: 'https://db.test',
  VITE_SUPABASE_ANON_KEY: 'anon-key',
});

function request(method: string, path: string, body?: Uint8Array<ArrayBuffer>, token: string | null = 'user-token') {
  return new Request(`https://site.test${path}`, { method, body, headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

describe('PUT /api/photos/:candidateId', () => {
  it('asks the database, saves the file, then records it', async () => {
    const { bucket, files } = memoryBucket();
    const db = fakeSupabase({ authorize_photo_upload: { body: KEY }, record_photo: { body: TAKEN_AT } });

    const response = await handlePhotoRequest(request('PUT', `/api/photos/${ID}`, JPEG), envWith(bucket), db.fetchImpl);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ photo_taken_at: TAKEN_AT });
    expect(db.fns()).toEqual(['authorize_photo_upload', 'record_photo']);
    expect(db.calls[0]).toEqual({
      url: 'https://db.test/rest/v1/rpc/authorize_photo_upload',
      fn: 'authorize_photo_upload',
      args: { p_candidate_id: ID },
      authorization: 'Bearer user-token',
      apikey: 'anon-key',
    });
    expect(bucket.put).toHaveBeenCalledWith(KEY, JPEG, { httpMetadata: { contentType: 'image/jpeg' } });
    expect(files.get(KEY)).toEqual(JPEG);
  });

  it('does not record a photo whose file could not be saved', async () => {
    const { bucket } = memoryBucket();
    bucket.put.mockRejectedValueOnce(new Error('R2 is down'));
    const db = fakeSupabase({ authorize_photo_upload: { body: KEY }, record_photo: { body: TAKEN_AT } });

    const response = await handlePhotoRequest(request('PUT', `/api/photos/${ID}`, JPEG), envWith(bucket), db.fetchImpl);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Couldn't save the photo. Try again." });
    expect(db.fns()).toEqual(['authorize_photo_upload']);
  });

  it('refuses a declared size over 1 MB before asking the database', async () => {
    const { bucket } = memoryBucket();
    const db = fakeSupabase({});
    const big = request('PUT', `/api/photos/${ID}`, JPEG);
    Object.defineProperty(big, 'headers', {
      value: new Headers({ Authorization: 'Bearer user-token', 'Content-Length': String(MAX_PHOTO_BYTES + 1) }),
    });

    const response = await handlePhotoRequest(big, envWith(bucket), db.fetchImpl);

    expect(response.status).toBe(413);
    expect(db.fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a body over 1 MB and anything that is not a JPEG, without saving or recording', async () => {
    const { bucket } = memoryBucket();
    const db = fakeSupabase({ authorize_photo_upload: { body: KEY }, record_photo: { body: TAKEN_AT } });
    const tooBig = new Uint8Array(MAX_PHOTO_BYTES + 1);
    tooBig.set([0xff, 0xd8, 0xff]);

    const big = await handlePhotoRequest(request('PUT', `/api/photos/${ID}`, tooBig), envWith(bucket), db.fetchImpl);
    const png = await handlePhotoRequest(request('PUT', `/api/photos/${ID}`, new Uint8Array([0x89, 0x50, 0x4e, 0x47])), envWith(bucket), db.fetchImpl);

    expect(big.status).toBe(413);
    expect(await big.json()).toEqual({ error: 'The photo is too large (over 1 MB).' });
    expect(png.status).toBe(415);
    expect(await png.json()).toEqual({ error: 'The photo must be a JPEG.' });
    expect(bucket.put).not.toHaveBeenCalled();
    expect(db.fns()).toEqual(['authorize_photo_upload', 'authorize_photo_upload']);
  });

  it("passes the database's refusal through", async () => {
    const { bucket } = memoryBucket();
    const db = fakeSupabase({ authorize_photo_upload: { status: 400, body: { code: 'P0001', message: 'Candidate #12 is not waiting' } } });

    const response = await handlePhotoRequest(request('PUT', `/api/photos/${ID}`, JPEG), envWith(bucket), db.fetchImpl);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Candidate #12 is not waiting' });
    expect(bucket.put).not.toHaveBeenCalled();
  });
});

describe('logins, permissions and routes', () => {
  it('maps an expired login to 401 and a role refusal to 403', async () => {
    const { bucket } = memoryBucket();
    const expired = fakeSupabase({ authorize_photo_upload: { status: 401, body: { code: 'PGRST303', message: 'JWT expired' } } });
    const refused = fakeSupabase({ authorize_photo_upload: { status: 403, body: { code: '42501', message: 'Not allowed' } } });

    const a = await handlePhotoRequest(request('PUT', `/api/photos/${ID}`, JPEG), envWith(bucket), expired.fetchImpl);
    const b = await handlePhotoRequest(request('PUT', `/api/photos/${ID}`, JPEG), envWith(bucket), refused.fetchImpl);

    expect([a.status, await a.json()]).toEqual([401, { error: 'Your login has expired. Sign in again.' }]);
    expect([b.status, await b.json()]).toEqual([403, { error: 'Not allowed' }]);
  });

  it('reports an unreachable database as 502', async () => {
    const { bucket } = memoryBucket();
    const offline = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });

    const response = await handlePhotoRequest(request('GET', `/api/photos/${ID}`), envWith(bucket), offline);

    expect([response.status, await response.json()]).toEqual([502, { error: "Can't reach the database. Try again." }]);
  });

  it('asks for a login before calling the database', async () => {
    const db = fakeSupabase({});
    const response = await handlePhotoRequest(request('GET', `/api/photos/${ID}`, undefined, null), envWith(memoryBucket().bucket), db.fetchImpl);
    expect([response.status, await response.json()]).toEqual([401, { error: 'Sign in first.' }]);
    expect(db.fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses bad ids, wrong methods and other paths', async () => {
    const env = envWith(memoryBucket().bucket);
    const db = fakeSupabase({});

    const badId = await handlePhotoRequest(request('GET', '/api/photos/not-a-uuid'), env, db.fetchImpl);
    const post = await handlePhotoRequest(request('POST', `/api/photos/${ID}`, JPEG), env, db.fetchImpl);
    const getAll = await handlePhotoRequest(request('GET', '/api/photos'), env, db.fetchImpl);
    const other = await handlePhotoRequest(request('GET', '/api/other'), env, db.fetchImpl);

    expect([badId.status, await badId.json()]).toEqual([400, { error: 'Unknown candidate' }]);
    expect([post.status, post.headers.get('Allow')]).toEqual([405, 'GET, PUT']);
    expect([getAll.status, getAll.headers.get('Allow')]).toEqual([405, 'DELETE']);
    expect(other.status).toBe(404);
    expect(db.fetchImpl).not.toHaveBeenCalled();
  });
});

describe('GET /api/photos/:candidateId', () => {
  it('sends the photo, never to be cached by the browser', async () => {
    const { bucket } = memoryBucket([[KEY, JPEG]]);
    const db = fakeSupabase({ authorize_photo_view: { body: KEY } });

    const response = await handlePhotoRequest(request('GET', `/api/photos/${ID}?v=${encodeURIComponent(TAKEN_AT)}`), envWith(bucket), db.fetchImpl);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG);
    expect(db.calls[0].args).toEqual({ p_candidate_id: ID });
  });

  it('answers 404 when there is no photo, or the file is missing', async () => {
    const { bucket } = memoryBucket();
    const none = fakeSupabase({ authorize_photo_view: { body: null } });
    const missing = fakeSupabase({ authorize_photo_view: { body: KEY } });

    const a = await handlePhotoRequest(request('GET', `/api/photos/${ID}`), envWith(bucket), none.fetchImpl);
    const b = await handlePhotoRequest(request('GET', `/api/photos/${ID}`), envWith(bucket), missing.fetchImpl);

    expect([a.status, await a.json()]).toEqual([404, { error: 'No photo' }]);
    expect([b.status, await b.json()]).toEqual([404, { error: 'No photo' }]);
    expect(bucket.get).toHaveBeenCalledTimes(1);
  });
});

describe('DELETE /api/photos', () => {
  it('deletes every file page by page, then clears the records', async () => {
    const { bucket, files } = memoryBucket(Array.from({ length: 2500 }, (_, i) => [`ind-1/${String(i).padStart(4, '0')}.jpg`, JPEG]));
    const db = fakeSupabase({ authorize_photo_purge: { body: null }, clear_photos: { body: 2500 } });

    const response = await handlePhotoRequest(request('DELETE', '/api/photos'), envWith(bucket), db.fetchImpl);

    expect([response.status, await response.json()]).toEqual([200, { deleted: 2500 }]);
    expect(files.size).toBe(0);
    expect(bucket.list).toHaveBeenCalledTimes(3);
    for (const [keys] of bucket.delete.mock.calls) expect((keys as string[]).length).toBeLessThanOrEqual(1000);
    expect(db.fns()).toEqual(['authorize_photo_purge', 'clear_photos']);
  });

  it('is harmless to run again', async () => {
    const { bucket } = memoryBucket();
    const db = fakeSupabase({ authorize_photo_purge: { body: null }, clear_photos: { body: 0 } });

    const response = await handlePhotoRequest(request('DELETE', '/api/photos'), envWith(bucket), db.fetchImpl);

    expect([response.status, await response.json()]).toEqual([200, { deleted: 0 }]);
    expect(bucket.delete).not.toHaveBeenCalled();
  });

  it('refuses non-admins without touching the bucket', async () => {
    const { bucket } = memoryBucket([[KEY, JPEG]]);
    const db = fakeSupabase({ authorize_photo_purge: { status: 403, body: { code: '42501', message: 'Not allowed' } } });

    const response = await handlePhotoRequest(request('DELETE', '/api/photos'), envWith(bucket), db.fetchImpl);

    expect(response.status).toBe(403);
    expect(bucket.list).not.toHaveBeenCalled();
  });

  it('keeps the records when a file could not be deleted, so running it again finishes the job', async () => {
    const { bucket } = memoryBucket([[KEY, JPEG]]);
    bucket.delete.mockRejectedValueOnce(new Error('R2 is down'));
    const db = fakeSupabase({ authorize_photo_purge: { body: null }, clear_photos: { body: 1 } });

    const response = await handlePhotoRequest(request('DELETE', '/api/photos'), envWith(bucket), db.fetchImpl);

    expect([response.status, await response.json()]).toEqual([502, { error: "Couldn't delete every photo. Try again." }]);
    expect(db.fns()).toEqual(['authorize_photo_purge']);
  });
});
```

In `tsconfig.json`, replace the `include` line with:

```json
  "include": ["src", "server", "functions", "tests/setup.ts", "tests/unit/web", "tests/unit/photos", "vite.config.ts", "vitest.config.ts"]
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run tests/unit/photos/handler.test.ts`
Expected: FAIL with `Failed to resolve import "../../../server/photos/handler.ts"`.

- [ ] **Step 3: Write the handler**

`server/photos/limits.ts`:

```ts
// Photo limits shared by the browser (shrinking) and the server (refusing). Spec §2.

/** The browser shrinks every photo to this many pixels on its long side. */
export const PHOTO_LONG_SIDE = 800;

/** The server refuses anything bigger. A shrunk photo is about a tenth of this. */
export const MAX_PHOTO_BYTES = 1_048_576;
```

`server/photos/bucket.ts`:

```ts
/**
 * The part of Cloudflare's R2Bucket the photo API uses. The real R2 binding (env.PHOTOS on Pages)
 * satisfies it; the Vite dev server and the tests use folderBucket() instead.
 */
export interface PhotoBucket {
  put(key: string, value: Uint8Array<ArrayBuffer>, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream } | null>;
  /** Up to 1000 keys at once. */
  delete(keys: string | string[]): Promise<unknown>;
  list(options?: { limit?: number; cursor?: string }): Promise<{ objects: Array<{ key: string }>; truncated: boolean; cursor?: string }>;
}
```

`server/photos/gate.ts`:

```ts
// Asks the database, as the signed-in user, whether a photo request is allowed. Supabase checks the
// user's token and the role rules when it runs the function; this file never reads the token itself.

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** A refusal with the HTTP status and message the photo API answers with. */
export class PhotoError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface SupabaseEnv {
  VITE_SUPABASE_URL: string;
  VITE_SUPABASE_ANON_KEY: string;
}

const TIMEOUT_MS = 10_000;

/** Calls one database function with the user's own token (PostgREST RPC) and returns its result. */
export async function callRpc<T>(env: SupabaseEnv, token: string, fn: string, args: Record<string, unknown>, fetchImpl: FetchLike): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(`${env.VITE_SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new PhotoError(502, "Can't reach the database. Try again.");
  }
  const text = await response.text().catch(() => '');
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (response.ok) return body as T;
  const error = (body ?? {}) as { code?: string; message?: string };
  if (response.status === 401) throw new PhotoError(401, 'Your login has expired. Sign in again.');
  if (response.status === 403 || error.code === '42501') throw new PhotoError(403, 'Not allowed');
  if (response.status >= 500) throw new PhotoError(502, "The database couldn't answer. Try again.");
  throw new PhotoError(400, error.message?.trim() || 'Refused');
}
```

`server/photos/handler.ts`:

```ts
// The photo API (spec §7). Cloudflare Pages runs it for /api/photos (functions/api/photos/[[path]].ts),
// the Vite dev server runs it against a local folder, and the tests call it directly.
import type { PhotoBucket } from './bucket.ts';
import { callRpc, PhotoError, type FetchLike, type SupabaseEnv } from './gate.ts';
import { MAX_PHOTO_BYTES } from './limits.ts';

export interface PhotoEnv extends SupabaseEnv {
  PHOTOS: PhotoBucket;
}

type Rpc = <T>(fn: string, args?: Record<string, unknown>) => Promise<T>;

const ROUTE = /^\/api\/photos(?:\/([^/]*))?\/?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOO_LARGE = 'The photo is too large (over 1 MB).';

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

function bearer(request: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get('Authorization') ?? '');
  return match ? match[1] : null;
}

const isJpeg = (bytes: Uint8Array) => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

export async function handlePhotoRequest(
  request: Request,
  env: PhotoEnv,
  fetchImpl: FetchLike = (url, init) => fetch(url, init),
): Promise<Response> {
  const match = ROUTE.exec(new URL(request.url).pathname);
  if (!match) return json(404, { error: 'Not found' });
  const candidateId = match[1] || null;
  const allowed = candidateId ? ['GET', 'PUT'] : ['DELETE'];
  if (!allowed.includes(request.method)) return json(405, { error: 'Method not allowed' }, { Allow: allowed.join(', ') });
  if (candidateId && !UUID.test(candidateId)) return json(400, { error: 'Unknown candidate' });
  const token = bearer(request);
  if (!token) return json(401, { error: 'Sign in first.' });

  const rpc: Rpc = (fn, args = {}) => callRpc(env, token, fn, args, fetchImpl);
  try {
    if (!candidateId) return await deleteAll(env.PHOTOS, rpc);
    if (request.method === 'GET') return await view(env.PHOTOS, rpc, candidateId);
    return await upload(request, env.PHOTOS, rpc, candidateId);
  } catch (e) {
    if (e instanceof PhotoError) return json(e.status, { error: e.message });
    return json(502, { error: 'Something went wrong. Try again.' });
  }
}

/** Save first, record second: the database never claims a photo whose file isn't there. */
async function upload(request: Request, bucket: PhotoBucket, rpc: Rpc, candidateId: string): Promise<Response> {
  if (Number(request.headers.get('Content-Length') ?? '0') > MAX_PHOTO_BYTES) return json(413, { error: TOO_LARGE });
  const key = await rpc<string>('authorize_photo_upload', { p_candidate_id: candidateId });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_PHOTO_BYTES) return json(413, { error: TOO_LARGE });
  if (!isJpeg(bytes)) return json(415, { error: 'The photo must be a JPEG.' });
  try {
    await bucket.put(key, bytes, { httpMetadata: { contentType: 'image/jpeg' } });
  } catch {
    throw new PhotoError(502, "Couldn't save the photo. Try again.");
  }
  const takenAt = await rpc<string>('record_photo', { p_candidate_id: candidateId });
  return json(200, { photo_taken_at: takenAt });
}

async function view(bucket: PhotoBucket, rpc: Rpc, candidateId: string): Promise<Response> {
  const key = await rpc<string | null>('authorize_photo_view', { p_candidate_id: candidateId });
  if (!key) return json(404, { error: 'No photo' });
  let object: { body: ReadableStream } | null;
  try {
    object = await bucket.get(key);
  } catch {
    throw new PhotoError(502, "Couldn't load the photo. Try again.");
  }
  if (!object) return json(404, { error: 'No photo' });
  return new Response(object.body, {
    status: 200,
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

/** Files first, records second, so an interrupted run leaves records that point at deleted files, and running it again finishes the job. */
async function deleteAll(bucket: PhotoBucket, rpc: Rpc): Promise<Response> {
  await rpc<null>('authorize_photo_purge');
  try {
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ limit: 1000, cursor });
      const keys = page.objects.map((object) => object.key);
      if (keys.length > 0) await bucket.delete(keys);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  } catch {
    throw new PhotoError(502, "Couldn't delete every photo. Try again.");
  }
  const cleared = await rpc<number>('clear_photos');
  return json(200, { deleted: cleared });
}
```

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run tests/unit/photos/handler.test.ts && npm run typecheck`
Expected: every test in `handler.test.ts` passes, and `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add server/photos tests/unit/photos/handler.test.ts tsconfig.json
git commit -m "feat(photos): photo API handler: upload, view and delete-all, checked by the database"
```

---

### Task 3: A local stand-in for R2, the dev server route and the Pages Function

**Files:**
- Create: `server/photos/folderBucket.ts`
- Create: `server/photos/devServer.ts`
- Create: `functions/api/photos/[[path]].ts`
- Create: `tests/unit/photos/folderBucket.test.ts`
- Modify: `vite.config.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: Task 2's `PhotoBucket`, `PhotoEnv` and `handlePhotoRequest`.
- Produces:
  - `folderBucket(root: string): PhotoBucket` (Node only, never imported by `handler.ts`). Its `list` cursor is the last key returned, so deleting between pages is safe.
  - `servePhotoRequest(req: IncomingMessage, res: ServerResponse, env: PhotoEnv): Promise<void>`.
  - The Pages route `functions/api/photos/[[path]].ts` exports `onRequest`.
  - `npm run dev` serves `/api/photos`, saving files in `.local-photos/`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/photos/folderBucket.test.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { folderBucket } from '../../../server/photos/folderBucket.ts';

const bytes = (...values: number[]) => new Uint8Array(values);

describe('folderBucket', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'photos-test-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('saves and reads files in nested folders', async () => {
    const bucket = folderBucket(root);
    await bucket.put('ind-1/c1.jpg', bytes(0xff, 0xd8, 0xff));
    const object = await bucket.get('ind-1/c1.jpg');
    expect(new Uint8Array(await new Response(object!.body).arrayBuffer())).toEqual(bytes(0xff, 0xd8, 0xff));
    expect(await bucket.get('ind-1/missing.jpg')).toBeNull();
  });

  it('lists in pages whose cursor survives deleting what was listed', async () => {
    const bucket = folderBucket(root);
    for (const name of ['a', 'b', 'c', 'd', 'e']) await bucket.put(`ind-1/${name}.jpg`, bytes(1));

    const first = await bucket.list({ limit: 2 });
    expect(first).toEqual({ objects: [{ key: 'ind-1/a.jpg' }, { key: 'ind-1/b.jpg' }], truncated: true, cursor: 'ind-1/b.jpg' });
    await bucket.delete(first.objects.map((o) => o.key));

    const second = await bucket.list({ limit: 2, cursor: first.cursor });
    expect(second.objects.map((o) => o.key)).toEqual(['ind-1/c.jpg', 'ind-1/d.jpg']);
    await bucket.delete('ind-1/c.jpg');
    const third = await bucket.list({ limit: 2, cursor: second.cursor });
    expect(third).toEqual({ objects: [{ key: 'ind-1/e.jpg' }], truncated: false });
  });

  it('lists nothing in a folder that does not exist yet', async () => {
    expect(await folderBucket(join(root, 'not-yet')).list()).toEqual({ objects: [], truncated: false });
  });

  it('refuses keys that point outside its folder', async () => {
    await expect(folderBucket(root).put('../escape.jpg', bytes(1))).rejects.toThrow('Bad key');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/unit/photos/folderBucket.test.ts`
Expected: FAIL with `Failed to resolve import "../../../server/photos/folderBucket.ts"`.

- [ ] **Step 3: Write the folder bucket, the dev server route and the Pages Function**

`server/photos/folderBucket.ts`:

```ts
// A PhotoBucket in a local folder: the Vite dev server's and the tests' stand-in for R2. Node only;
// the handler never imports it, so the Pages Function bundle stays free of node:fs.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { PhotoBucket } from './bucket.ts';

export function folderBucket(root: string): PhotoBucket {
  const base = resolve(root);

  function pathOf(key: string): string {
    const path = resolve(base, key);
    if (path !== base && !path.startsWith(base + sep)) throw new Error(`Bad key: ${key}`);
    return path;
  }

  async function allKeys(dir = base): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const keys: string[] = [];
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) keys.push(...(await allKeys(path)));
      else keys.push(relative(base, path).split(sep).join('/'));
    }
    return keys;
  }

  return {
    async put(key, value) {
      const path = pathOf(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, value);
    },
    async get(key) {
      try {
        const data = await readFile(pathOf(key));
        return { body: new Blob([new Uint8Array(data)]).stream() };
      } catch {
        return null;
      }
    },
    async delete(keys) {
      for (const key of [keys].flat()) await rm(pathOf(key), { force: true });
    },
    // Like R2, the cursor is a position in key order (the last key returned), so deleting what a page
    // listed never makes the next page skip anything.
    async list({ limit = 1000, cursor } = {}) {
      const keys = (await allKeys()).sort().filter((key) => !cursor || key > cursor);
      const page = keys.slice(0, limit);
      const objects = page.map((key) => ({ key }));
      return keys.length > page.length ? { objects, truncated: true, cursor: page[page.length - 1] } : { objects, truncated: false };
    },
  };
}
```

`server/photos/devServer.ts`:

```ts
// Runs one Node request through the photo handler: `npm run dev` serves /api/photos with this, so the
// code Cloudflare runs is the code you develop against.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handlePhotoRequest, type PhotoEnv } from './handler.ts';

export async function servePhotoRequest(req: IncomingMessage, res: ServerResponse, env: PhotoEnv): Promise<void> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) chunks.push(chunk as Uint8Array);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const request = new Request(new URL(req.url ?? '/', 'http://localhost'), {
    method: req.method,
    headers,
    body: hasBody ? new Uint8Array(Buffer.concat(chunks)) : undefined,
  });
  const response = await handlePhotoRequest(request, env);
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(new Uint8Array(await response.arrayBuffer()));
}
```

`functions/api/photos/[[path]].ts`:

```ts
// Cloudflare Pages runs this for /api/photos and /api/photos/<candidate id>. PHOTOS is the R2 bucket
// binding; VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are the project's environment variables.
// The logic lives in server/photos so the dev server and the tests run exactly the same code.
import { handlePhotoRequest, type PhotoEnv } from '../../../server/photos/handler.ts';

export const onRequest = ({ request, env }: { request: Request; env: PhotoEnv }): Promise<Response> =>
  handlePhotoRequest(request, env);
```

Replace `vite.config.ts` with:

```ts
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { servePhotoRequest } from './server/photos/devServer.ts';
import { folderBucket } from './server/photos/folderBucket.ts';

/** `npm run dev` serves /api/photos with the same handler as Cloudflare, keeping photos in .local-photos/. */
function localPhotoApi(): Plugin {
  return {
    name: 'local-photo-api',
    apply: 'serve',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), 'VITE_');
      const photoEnv = {
        PHOTOS: folderBucket('.local-photos'),
        VITE_SUPABASE_URL: env.VITE_SUPABASE_URL ?? '',
        VITE_SUPABASE_ANON_KEY: env.VITE_SUPABASE_ANON_KEY ?? '',
      };
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/photos')) return next();
        servePhotoRequest(req, res, photoEnv).catch(next);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localPhotoApi()],
  build: {
    // One small app for ~25 staff screens and a projector: ~170 KB gzipped, mostly React and supabase-js.
    chunkSizeWarningLimit: 800,
  },
});
```

Add to `.gitignore`, after `playwright-report/`:

```
# Candidate photos saved by the local dev server (R2 in production)
.local-photos/
```

- [ ] **Step 4: Run the tests, the type check and the build**

Run: `npx vitest run tests/unit/photos && npm run typecheck && npm run build`
Expected:
- Both photo test files pass.
- `tsc` prints nothing.
- `vite build` writes `dist/`, and `dist/` contains no `server` or `functions` files. Check with `ls dist`: you should see only `index.html`, `assets` and the public files.

- [ ] **Step 5: Check the dev server route by hand**

Run (the local stack must be up):

```bash
npm run web:env
npm run dev -- --port 5174 --strictPort   # leave it running (second terminal or background)
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5174/api/photos/00000000-0000-0000-0000-000000000000
curl -s http://localhost:5174/api/photos/not-a-uuid
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:5174/queue
```

Expected: `401`, then `{"error":"Unknown candidate"}`, then `200` (the app itself is untouched). Stop the dev server afterwards.

- [ ] **Step 6: Commit**

```bash
git add server/photos/folderBucket.ts server/photos/devServer.ts "functions/api/photos/[[path]].ts" tests/unit/photos/folderBucket.test.ts vite.config.ts .gitignore
git commit -m "feat(photos): Pages Function route, and a local folder in place of R2 for npm run dev"
```

---

### Task 4: Photo calls, the new role and the new fields in the web API

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/api.ts`
- Modify: `supabase/functions/_shared/accounts.ts`
- Modify: `src/app/homePath.ts`
- Modify: `tests/unit/web/helpers.tsx`
- Modify: `tests/unit/web/fixtures.ts`
- Modify: `tests/unit/web/api.test.ts`
- Modify: `tests/unit/admin-users-validate.test.ts`
- Modify: `tests/integration/web-api.test.ts`
- Modify: `tests/integration/web-panel-admin.test.ts`
- Create: `tests/integration/photos.test.ts`

**Interfaces:**
- Consumes: Task 1's database functions and fields; Task 2's `handlePhotoRequest`; Task 3's `folderBucket` (integration test only).
- Produces:
  - `Role` gains `'photographer'` (in `src/lib/types.ts` and `ROLES` in `accounts.ts`); `ROLE_LABELS.photographer = 'Photographer'`; `homePath('photographer') === '/photos'`.
  - `LaneEntry.has_photo: boolean`; `Candidate.photo_taken_at: string | null` (added to `CANDIDATE_COLUMNS`).
  - `interface PhotoQueueEntry { candidate_id: string; number: number; name: string; checked_in_at: string | null; photo_taken_at: string | null }`.
  - `type PhotoFetch = (url: string, init: RequestInit) => Promise<Response>` and `ApiOptions.photoFetch?: PhotoFetch`.
  - `Api.photoQueue(): Promise<PhotoQueueEntry[]>`, `Api.uploadPhoto(candidateId, jpeg: Blob): Promise<string>` (resolves to `photo_taken_at`), `Api.photoBlob(candidateId, version: string): Promise<Blob | null>`, `Api.photoCount(): Promise<number>`, `Api.deleteAllPhotos(): Promise<number>`.
  - Test helpers: `fakeApi()` defaults for the five new methods; `lane()` entries default to `has_photo: true`; `candidateRow()` gets `photo_taken_at: null`.

- [ ] **Step 1: Write the failing unit tests**

Append to `tests/unit/web/api.test.ts`, and add `type ApiOptions, type PhotoFetch` to its import from `../../../src/lib/api.ts`:

```ts
describe('photo calls', () => {
  const session = { data: { session: { access_token: 'user-token' } } };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  function photoApi(photoFetch: PhotoFetch, options: ApiOptions = {}) {
    const rpc = vi.fn(() => query(Promise.resolve({ data: 5, error: null, status: 200 })));
    const client = { rpc, auth: { getSession: vi.fn(async () => session) } } as unknown as SupabaseClient;
    return { rpc, api: createApi(client, { ...options, photoFetch }) };
  }

  it("uploads the JPEG with the signed-in user's token", async () => {
    const photoFetch = vi.fn(async (_url: string, _init: RequestInit) => json({ photo_taken_at: '2026-09-27T10:00:00+00:00' }));
    const { api } = photoApi(photoFetch);
    const jpeg = new Blob(['jpeg'], { type: 'image/jpeg' });

    await expect(api.uploadPhoto('c1', jpeg)).resolves.toBe('2026-09-27T10:00:00+00:00');
    const [url, init] = photoFetch.mock.calls[0];
    expect(url).toBe('/api/photos/c1');
    expect(init).toMatchObject({ method: 'PUT', body: jpeg, headers: { 'Content-Type': 'image/jpeg', Authorization: 'Bearer user-token' } });
  });

  it('downloads a photo by version, and gives null when there is none', async () => {
    const photoFetch = vi.fn(async (url: string, _init: RequestInit) =>
      url.startsWith('/api/photos/c1') ? new Response(new Blob(['jpeg'])) : json({ error: 'No photo' }, 404),
    );
    const { api } = photoApi(photoFetch);

    const blob = await api.photoBlob('c1', '2026-09-27T10:00:00+00:00');
    expect(await blob?.text()).toBe('jpeg');
    expect(photoFetch.mock.calls[0][0]).toBe('/api/photos/c1?v=2026-09-27T10%3A00%3A00%2B00%3A00');
    await expect(api.photoBlob('c2', 'v1')).resolves.toBeNull();
  });

  it('deletes every photo and reports how many', async () => {
    const photoFetch = vi.fn(async (_url: string, _init: RequestInit) => json({ deleted: 3 }));
    const { api } = photoApi(photoFetch);

    await expect(api.deleteAllPhotos()).resolves.toBe(3);
    expect(photoFetch.mock.calls[0][0]).toBe('/api/photos');
    expect(photoFetch.mock.calls[0][1].method).toBe('DELETE');
  });

  it("shows the server's message, and treats 401 and 403 as \"Not allowed\"", async () => {
    const listener = vi.fn();
    const stop = notAllowed.subscribe(listener);
    const replies = [json({ error: 'Candidate #12 is not waiting' }, 400), json({ error: 'Sign in first.' }, 401), json({ error: 'Not allowed' }, 403)];
    const { api } = photoApi(vi.fn(async () => replies.shift()!));
    const jpeg = new Blob(['jpeg']);

    await expect(api.uploadPhoto('c12', jpeg)).rejects.toEqual(new ApiError('Candidate #12 is not waiting'));
    await expect(api.uploadPhoto('c12', jpeg)).rejects.toEqual(new ApiError(NOT_ALLOWED));
    await expect(api.photoBlob('c12', 'v1')).rejects.toEqual(new ApiError(NOT_ALLOWED));
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
  });

  it('reports a failed request as a network problem and a stalled one as a timeout', async () => {
    const { api: offline } = photoApi(vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    await expect(offline.uploadPhoto('c1', new Blob(['jpeg']))).rejects.toEqual(new ApiError(NETWORK_ERROR));

    const stalled: PhotoFetch = (_url, init) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    const { api: slow } = photoApi(stalled, { timeoutMs: 20 });
    await expect(slow.uploadPhoto('c1', new Blob(['jpeg']))).rejects.toEqual(new ApiError(TIMEOUT_ERROR));
  });

  it('calls the photo queue and photo count functions', async () => {
    const { rpc, api } = photoApi(vi.fn());
    await api.photoQueue();
    await api.photoCount();
    expect(rpc.mock.calls).toEqual([['photo_queue', undefined], ['photo_count', undefined]]);
  });
});
```

Append to `tests/unit/admin-users-validate.test.ts` (inside its top-level `describe`, using the `validateCommand` it already imports):

```ts
  it('accepts the photographer role', () => {
    const parsed = validateCommand({ action: 'create', username: 'photos_one', displayName: 'Photos One', role: 'photographer', password: 'long-enough-1' });
    expect(parsed.ok).toBe(true);
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/unit/web/api.test.ts tests/unit/admin-users-validate.test.ts`
Expected: FAIL. `api.uploadPhoto is not a function` (and the rest of the photo calls), and the photographer role is refused by `validateCommand`.

- [ ] **Step 3: Add the role, the fields and the photo calls**

In `supabase/functions/_shared/accounts.ts`, change the roles line to:

```ts
export const ROLES = ['admin', 'queue_manager', 'panelist', 'photographer'] as const;
```

In `src/lib/types.ts`:
- Change `Role` to `export type Role = 'admin' | 'queue_manager' | 'panelist' | 'photographer';`.
- Add to `LaneEntry`, after `checked_in_at`:

```ts
  /** False shows the queue manager's camera icon and the "no photo yet" question at Send in. */
  has_photo: boolean;
```

- Add to `Candidate`, after `decision: Decision;`:

```ts
  /** When the photo on file was taken (also its version); null = no photo. */
  photo_taken_at: string | null;
```

- Add after `CandidateSummary`:

```ts
/** One waiting candidate on the photographer's list (photo_queue()). */
export interface PhotoQueueEntry {
  candidate_id: string;
  number: number;
  name: string;
  checked_in_at: string | null;
  photo_taken_at: string | null;
}
```

In `src/app/homePath.ts`, make `homePath` and `ROLE_LABELS`:

```ts
export function homePath(role: Role): string {
  if (role === 'queue_manager') return '/queue';
  if (role === 'panelist') return '/panel';
  if (role === 'photographer') return '/photos';
  return '/admin';
}
```

```ts
export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  queue_manager: 'Queue manager',
  panelist: 'Panelist',
  photographer: 'Photographer',
};
```

In `src/lib/api.ts`:
- Add `PhotoQueueEntry` to the type import from `./types.ts`.
- Change `CANDIDATE_COLUMNS` to:

```ts
const CANDIDATE_COLUMNS =
  'id, number, reg_number, full_name, email, account_email, phone, department, batch, submitted_at, preferences, answers, status, checked_in_at, decision, photo_taken_at';
```

- Add to the `Api` interface, after `publishedResults`:

```ts

  // Photos (photographer, queue manager, admin; panelists view)
  /** Everyone waiting, for the photographer's screen. */
  photoQueue(): Promise<PhotoQueueEntry[]>;
  /** Saves the photo (already shrunk to a JPEG); resolves to its photo_taken_at. */
  uploadPhoto(candidateId: string, jpeg: Blob): Promise<string>;
  /** The photo for this version (photo_taken_at); null when there is none. */
  photoBlob(candidateId: string, version: string): Promise<Blob | null>;
  /** Admins: how many candidates have a photo. */
  photoCount(): Promise<number>;
  /** Admins: deletes every photo file and record; resolves to how many records were cleared. */
  deleteAllPhotos(): Promise<number>;
```

- Replace `ApiOptions` with:

```ts
/** How photo requests reach /api/photos. The browser uses fetch; tests route them to the handler. */
export type PhotoFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface ApiOptions {
  /** Give up on a call after this long, so one stalled request can't hold up every later reload. */
  timeoutMs?: number;
  /** import_candidates handles hundreds of rows in one transaction; it gets longer. Deleting all photos too. */
  importTimeoutMs?: number;
  photoFetch?: PhotoFetch;
}
```

- Change the first line of `createApi` to:

```ts
export function createApi(
  client: SupabaseClient,
  { timeoutMs = 15_000, importTimeoutMs = 60_000, photoFetch = (url, init) => fetch(url, init) }: ApiOptions = {},
): Api {
```

- Add after the `rpc` helper inside `createApi`:

```ts
  /** One request to the photo API with the signed-in user's token and a deadline. */
  async function photoRequest(path: string, init: RequestInit = {}, limitMs = timeoutMs): Promise<Response> {
    const { data } = await client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw fail({ message: NOT_ALLOWED, code: '42501' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limitMs);
    let response: Response;
    try {
      response = await photoFetch(`/api/photos${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
    } catch {
      throw new ApiError(controller.signal.aborted ? TIMEOUT_ERROR : NETWORK_ERROR);
    } finally {
      clearTimeout(timer);
    }
    if (response.ok || (response.status === 404 && !init.method)) return response;
    if (response.status === 401 || response.status === 403) throw fail({ message: NOT_ALLOWED, code: '42501' });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error?.trim() || 'Something went wrong');
  }
```

- Add to the returned object, after `publishedResults`:

```ts

    photoQueue: () => rpc<PhotoQueueEntry[]>('photo_queue'),
    async uploadPhoto(candidateId, jpeg) {
      const response = await photoRequest(`/${candidateId}`, { method: 'PUT', body: jpeg, headers: { 'Content-Type': 'image/jpeg' } });
      return ((await response.json()) as { photo_taken_at: string }).photo_taken_at;
    },
    async photoBlob(candidateId, version) {
      const response = await photoRequest(`/${candidateId}?v=${encodeURIComponent(version)}`);
      return response.status === 404 ? null : await response.blob();
    },
    photoCount: () => rpc<number>('photo_count'),
    async deleteAllPhotos() {
      const response = await photoRequest('', { method: 'DELETE' }, importTimeoutMs);
      return ((await response.json()) as { deleted: number }).deleted;
    },
```

In `tests/unit/web/helpers.tsx`, add to `fakeApi()`'s `api` object, after `publishedResults`:

```ts
    photoQueue: vi.fn(async () => []),
    uploadPhoto: vi.fn(async () => '2026-09-26T10:05:00Z'),
    photoBlob: vi.fn(async () => new Blob(['jpeg'], { type: 'image/jpeg' })),
    photoCount: vi.fn(async () => 0),
    deleteAllPhotos: vi.fn(async () => 0),
```

In `tests/unit/web/fixtures.ts`:
- In `lane()`, add `has_photo: true,` after `checked_in_at: '2026-09-26T09:00:00Z',`. With `true` as the default, the existing Send in tests run as before.
- In `candidateRow()`, add `photo_taken_at: null,` after `decision: 'undecided',`.

- [ ] **Step 4: Run the unit tests and the type check**

Run: `npm run test:unit && npm run typecheck`
Expected: every unit test passes (the new photo calls and the photographer role included), and `tsc` prints nothing.

- [ ] **Step 5: Write the integration test (the real handler and the real local database)**

`tests/integration/photos.test.ts`:

```ts
// The photo API without a browser: the handler the Pages Function runs, a folder in place of R2, and
// the real local database deciding who may do what.
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { folderBucket } from '../../server/photos/folderBucket.ts';
import { handlePhotoRequest } from '../../server/photos/handler.ts';
import { ApiError, createApi, NOT_ALLOWED, type Api } from '../../src/lib/api.ts';
import { env, makeAccount, service, signIn, uniqueName } from './support.ts';

const JPEG = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0xff, 0xd9])], { type: 'image/jpeg' });
const sortedKeys = (value: object | null | undefined) => Object.keys(value ?? {}).sort();

describe('candidate photos', () => {
  const accountIds: string[] = [];
  let folder: string;
  let admin: Api;
  let qm: Api;
  let panelist: Api;
  let photographer: Api;
  let inductionId: string;
  let candidateId: string;
  let number: number;
  let panelId: string | undefined;
  let interviewId: string | undefined;

  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'photos-it-'));
    const photoEnv = { PHOTOS: folderBucket(folder), VITE_SUPABASE_URL: env.url, VITE_SUPABASE_ANON_KEY: env.anonKey };
    const photoFetch = (url: string, init: RequestInit) => handlePhotoRequest(new Request(new URL(url, 'http://localhost'), init), photoEnv);
    const names = { admin: uniqueName('ph_admin'), qm: uniqueName('ph_qm'), panelist: uniqueName('ph_pan'), photographer: uniqueName('ph_snap') };
    accountIds.push(
      await makeAccount(names.admin, 'admin'),
      await makeAccount(names.qm, 'queue_manager'),
      await makeAccount(names.panelist, 'panelist'),
      await makeAccount(names.photographer, 'photographer'),
    );
    [admin, qm, panelist, photographer] = await Promise.all(
      [names.admin, names.qm, names.panelist, names.photographer].map(async (name) => createApi(await signIn(name), { photoFetch })),
    );
    inductionId = (await qm.boardSnapshot()).induction.id;
    const reg = `PHOTO${Date.now()}`;
    await qm.importCandidates([{
      submitted_at: new Date().toISOString(), reg_number: reg, full_name: 'Photo Tester', email: '', account_email: '',
      phone: '', department: '', batch: '', preferences: ['', '', '', ''],
      answers: { general: [], dev: [], logikal: [], lnd: [], marketing: [] },
    }]);
    const candidate = (await qm.listCandidates(inductionId)).find((c) => c.reg_number === reg);
    if (!candidate) throw new Error('imported candidate not found');
    candidateId = candidate.id;
    number = candidate.number;
    await qm.checkIn(candidateId);
  });

  afterAll(async () => {
    if (interviewId) await qm.endInterview(interviewId).catch(() => undefined);
    if (panelId) await qm.deletePanel(panelId).catch(() => undefined);
    for (const id of accountIds) await service.auth.admin.deleteUser(id);
    await rm(folder, { recursive: true, force: true });
  });

  it('shows the photographer who is waiting, and nothing else', async () => {
    const entry = (await photographer.photoQueue()).find((e) => e.candidate_id === candidateId);
    expect(sortedKeys(entry)).toEqual(['candidate_id', 'checked_in_at', 'name', 'number', 'photo_taken_at']);
    expect(entry).toMatchObject({ number, name: 'Photo Tester', photo_taken_at: null });
    await expect(photographer.boardSnapshot()).rejects.toEqual(new ApiError(NOT_ALLOWED));
    await expect(photographer.listCandidates(inductionId)).resolves.toEqual([]); // row-level security hides the table
  });

  it('saves a photo in the bucket and marks the candidate', async () => {
    const takenAt = await photographer.uploadPhoto(candidateId, JPEG());

    expect(await readdir(join(folder, inductionId))).toEqual([`${candidateId}.jpg`]);
    expect((await photographer.photoQueue()).find((e) => e.candidate_id === candidateId)?.photo_taken_at).toBe(takenAt);
    expect((await qm.boardSnapshot()).pool.find((e) => e.candidate_id === candidateId)?.has_photo).toBe(true);
    expect((await panelist.candidate(candidateId)).photo_taken_at).toBe(takenAt);
    const blob = await panelist.photoBlob(candidateId, takenAt);
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(new Uint8Array(await JPEG().arrayBuffer()));
  });

  it('refuses the wrong people and the wrong files', async () => {
    await expect(panelist.uploadPhoto(candidateId, JPEG())).rejects.toEqual(new ApiError(NOT_ALLOWED));
    await expect(photographer.uploadPhoto(candidateId, new Blob(['not a jpeg']))).rejects.toEqual(new ApiError('The photo must be a JPEG.'));
    await expect(photographer.deleteAllPhotos()).rejects.toEqual(new ApiError(NOT_ALLOWED));
  });

  it('stops the photographer once the candidate has gone in', async () => {
    panelId = await qm.addPanel();
    interviewId = await qm.sendIn(candidateId, panelId);

    await expect(photographer.uploadPhoto(candidateId, JPEG())).rejects.toEqual(new ApiError(`Candidate #${number} is not waiting`));
    await expect(photographer.photoBlob(candidateId, 'any')).rejects.toEqual(new ApiError(NOT_ALLOWED));
    expect((await photographer.photoQueue()).some((e) => e.candidate_id === candidateId)).toBe(false);
    expect(await panelist.photoBlob(candidateId, 'any')).not.toBeNull();
  });

  it('lets an admin delete every photo, twice without harm', async () => {
    expect(await admin.photoCount()).toBeGreaterThanOrEqual(1);
    expect(await admin.deleteAllPhotos()).toBeGreaterThanOrEqual(1);
    expect(await admin.photoCount()).toBe(0);
    expect((await folderBucket(folder).list()).objects).toEqual([]);
    expect(await panelist.photoBlob(candidateId, 'any')).toBeNull();
    expect(await admin.deleteAllPhotos()).toBe(0);
  });
});
```

In `tests/integration/web-api.test.ts`, change the expected pool entry keys to:

```ts
    expect(sortedKeys(pooled)).toEqual(['candidate_id', 'checked_in_at', 'has_photo', 'name', 'number', 'position', 'reg_number', 'skip_count']);
```

In `tests/integration/web-panel-admin.test.ts`, change the expected candidate keys to:

```ts
    expect(sortedKeys(candidate)).toEqual([
      'account_email', 'answers', 'batch', 'checked_in_at', 'decision', 'department', 'email', 'full_name', 'id',
      'number', 'phone', 'photo_taken_at', 'preferences', 'reg_number', 'status', 'submitted_at',
    ]);
```

- [ ] **Step 6: Run the integration tests**

Run: `npm run functions:serve` in a second terminal (the admin-users tests need it), then `npm run test:integration`.
Expected: every integration test passes, `photos.test.ts` included.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/lib/api.ts supabase/functions/_shared/accounts.ts src/app/homePath.ts tests/unit/web/helpers.tsx tests/unit/web/fixtures.ts tests/unit/web/api.test.ts tests/unit/admin-users-validate.test.ts tests/integration/photos.test.ts tests/integration/web-api.test.ts tests/integration/web-panel-admin.test.ts
git commit -m "feat(web): photographer role, photo fields and photo calls in the API layer"
```

---

### Task 5: Showing photos: shrinking, the photo cache and the candidate card

**Files:**
- Create: `src/photos/shrinkPhoto.ts`
- Create: `src/photos/usePhoto.ts`
- Create: `src/photos/CandidatePhoto.tsx`
- Create: `tests/unit/web/shrinkPhoto.test.ts`
- Create: `tests/unit/web/candidatePhoto.test.tsx`
- Modify: `src/panel/CandidateCard.tsx`
- Modify: `src/app/StaffLayout.tsx`

**Interfaces:**
- Consumes: Task 2's `PHOTO_LONG_SIDE` and `MAX_PHOTO_BYTES`; Task 4's `Api.photoBlob` and `Candidate.photo_taken_at`.
- Produces:
  - `targetSize(width, height, max = PHOTO_LONG_SIDE): { width; height }`;
  - `shrinkPhoto(source: Blob): Promise<Blob>` (JPEG, ≤ 1 MB, upright; rejects with `UNREADABLE_PHOTO`);
  - `grabFrame(video: HTMLVideoElement): Promise<Blob>`;
  - `UNREADABLE_PHOTO = "This photo couldn't be read. Take it again."`;
  - `usePhoto(candidateId, version: string | null): string | null | undefined` (URL; `undefined` while loading; `null` when there is none or it failed);
  - `clearPhotoCache(): void`;
  - `<CandidatePhoto candidateId version name size?: 'sm' | 'md' | 'xl' />`. It shows an `img` named "Photo of {name}", or a placeholder named "Loading photo of {name}" or "No photo of {name}".
  - `CandidateCard` shows the photo (so the panel screens, the application dialog and `/results/:id` do too).
  - Signing out clears the cache.

- [ ] **Step 1: Write the failing tests**

`tests/unit/web/shrinkPhoto.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { targetSize } from '../../../src/photos/shrinkPhoto.ts';

describe('targetSize', () => {
  it('fits the long side to 800 px, landscape or portrait', () => {
    expect(targetSize(4000, 3000)).toEqual({ width: 800, height: 600 });
    expect(targetSize(3000, 4000)).toEqual({ width: 600, height: 800 });
  });
  it('never enlarges a small photo', () => {
    expect(targetSize(640, 480)).toEqual({ width: 640, height: 480 });
  });
  it('keeps at least one pixel on the short side', () => {
    expect(targetSize(8000, 2)).toEqual({ width: 800, height: 1 });
  });
});
```

`tests/unit/web/candidatePhoto.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../../src/lib/ApiProvider.tsx';
import type { Api } from '../../../src/lib/api.ts';
import { CandidatePhoto, initials } from '../../../src/photos/CandidatePhoto.tsx';
import { clearPhotoCache } from '../../../src/photos/usePhoto.ts';
import { candidateRecordFor, candidateRow, profile } from './fixtures.ts';
import { fakeApi, fakeAuth, renderApp } from './helpers.tsx';

function show(api: Api, ...photos: Array<{ id: string; version: string | null }>) {
  return render(
    <ApiProvider api={api}>
      {photos.map((p, i) => (
        <CandidatePhoto key={i} candidateId={p.id} version={p.version} name="Ali Khan" />
      ))}
    </ApiProvider>,
  );
}

describe('CandidatePhoto', () => {
  beforeEach(() => {
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:${++n}`);
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => clearPhotoCache());

  it('shows initials and downloads nothing when there is no photo', () => {
    const api = fakeApi();
    show(api, { id: 'c12', version: null });
    expect(screen.getByRole('img', { name: 'No photo of Ali Khan' })).toHaveTextContent('AK');
    expect(api.photoBlob).not.toHaveBeenCalled();
  });

  it('downloads the photo once, however many places show it', async () => {
    const api = fakeApi();
    show(api, { id: 'c12', version: 'v1' }, { id: 'c12', version: 'v1' });
    expect(screen.getAllByRole('img', { name: 'Loading photo of Ali Khan' })).toHaveLength(2);
    const images = await screen.findAllByRole('img', { name: 'Photo of Ali Khan' });
    expect(images.map((img) => img.getAttribute('src'))).toEqual(['blob:1', 'blob:1']);
    expect(api.photoBlob).toHaveBeenCalledTimes(1);
    expect(api.photoBlob).toHaveBeenCalledWith('c12', 'v1');
  });

  it('downloads a retake and frees the old one', async () => {
    const api = fakeApi();
    const view = show(api, { id: 'c12', version: 'v1' });
    await screen.findByRole('img', { name: 'Photo of Ali Khan' });
    view.rerender(
      <ApiProvider api={api}>
        <CandidatePhoto candidateId="c12" version="v2" name="Ali Khan" />
      </ApiProvider>,
    );
    await waitFor(() => expect(screen.getByRole('img', { name: 'Photo of Ali Khan' })).toHaveAttribute('src', 'blob:2'));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1');
  });

  it('shows the placeholder when the photo is missing', async () => {
    const api = fakeApi({ photoBlob: vi.fn(async () => null) });
    show(api, { id: 'c12', version: 'v1' });
    expect(await screen.findByRole('img', { name: 'No photo of Ali Khan' })).toBeInTheDocument();
  });

  it('makes initials from the first two words', () => {
    expect(initials('  ali   raza khan ')).toBe('AR');
    expect(initials('عائشہ خان')).toBe('عخ');
  });

  it('frees every photo when the user signs out', async () => {
    const api = fakeApi({ candidateRecord: vi.fn(async () => candidateRecordFor(candidateRow({ photo_taken_at: 'v1' }))) });
    renderApp('/results/c7', { api, auth: fakeAuth({ signedInAs: profile('admin') }).backend });
    expect(await screen.findByRole('img', { name: 'Photo of Sara Ahmed' })).toHaveAttribute('src', 'blob:1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1'));
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/unit/web/shrinkPhoto.test.ts tests/unit/web/candidatePhoto.test.tsx`
Expected: FAIL with `Failed to resolve import "../../../src/photos/shrinkPhoto.ts"` (and `CandidatePhoto.tsx`).

- [ ] **Step 3: Write the photo helpers and the component**

`src/photos/shrinkPhoto.ts`:

```ts
// Every photo is shrunk in the browser before it is sent: 800 px on the long side, JPEG, about 100 KB.
// Drawing it again also turns it upright and drops EXIF data such as the GPS position.
import { MAX_PHOTO_BYTES, PHOTO_LONG_SIDE } from '../../server/photos/limits.ts';

export const UNREADABLE_PHOTO = "This photo couldn't be read. Take it again.";

export function targetSize(width: number, height: number, max = PHOTO_LONG_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(UNREADABLE_PHOTO))), 'image/jpeg', quality),
  );
}

export async function shrinkPhoto(source: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(UNREADABLE_PHOTO);
  }
  try {
    const { width, height } = targetSize(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error(UNREADABLE_PHOTO);
    context.drawImage(bitmap, 0, 0, width, height);
    for (const quality of [0.82, 0.6]) {
      const blob = await toJpeg(canvas, quality);
      if (blob.size <= MAX_PHOTO_BYTES) return blob;
    }
    throw new Error(UNREADABLE_PHOTO);
  } finally {
    bitmap.close();
  }
}

/** The webcam's current frame as a JPEG (shrinkPhoto then brings it down to size). */
export function grabFrame(video: HTMLVideoElement): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error(UNREADABLE_PHOTO));
  context.drawImage(video, 0, 0);
  return toJpeg(canvas, 0.92);
}
```

`src/photos/usePhoto.ts`:

```ts
import { useEffect, useState } from 'react';
import type { Api } from '../lib/api.ts';
import { useApi } from '../lib/ApiProvider.tsx';

// One object URL per candidate, for the version last asked for. Module-level, so every card and row that
// shows the same photo shares one download. The server says no-store, so this is the only cache, and
// StaffLayout clears it when the user signs out (the next person on a shared laptop starts empty).
const cache = new Map<string, { version: string; url: Promise<string | null> }>();

function revoke(url: Promise<string | null>): void {
  void url.then((u) => {
    if (u) URL.revokeObjectURL(u);
  });
}

function photoUrl(api: Api, candidateId: string, version: string): Promise<string | null> {
  const hit = cache.get(candidateId);
  if (hit?.version === version) return hit.url;
  if (hit) revoke(hit.url);
  const url = api.photoBlob(candidateId, version).then(
    (blob) => (blob ? URL.createObjectURL(blob) : null),
    () => null,
  );
  cache.set(candidateId, { version, url });
  // A missing photo or a failed download isn't remembered, so the next time it is shown it is tried again.
  void url.then((u) => {
    if (u === null && cache.get(candidateId)?.url === url) cache.delete(candidateId);
  });
  return url;
}

/** Forgets every photo and frees its memory. */
export function clearPhotoCache(): void {
  for (const { url } of cache.values()) revoke(url);
  cache.clear();
}

/** The photo's object URL; undefined while it loads; null when there is none or it couldn't load. */
export function usePhoto(candidateId: string, version: string | null): string | null | undefined {
  const api = useApi();
  const key = version ? `${candidateId}@${version}` : null;
  const [loaded, setLoaded] = useState<{ key: string; url: string | null } | null>(null);

  useEffect(() => {
    if (!version || !key) return;
    let current = true;
    void photoUrl(api, candidateId, version).then((url) => {
      if (current) setLoaded({ key, url });
    });
    return () => {
      current = false;
    };
  }, [api, candidateId, version, key]);

  if (!key) return null;
  return loaded?.key === key ? loaded.url : undefined;
}
```

`src/photos/CandidatePhoto.tsx`:

```tsx
import { usePhoto } from './usePhoto.ts';

const SIZES = {
  sm: 'h-10 w-10 text-sm',
  md: 'h-20 w-20 text-2xl',
  xl: 'mx-auto aspect-square w-full max-w-xs text-5xl',
} as const;

/** "AK" for "Ali Khan": what the placeholder shows. */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? '')
    .join('')
    .toUpperCase();
}

interface CandidatePhotoProps {
  candidateId: string;
  /** photo_taken_at; null = no photo. */
  version: string | null;
  name: string;
  size?: keyof typeof SIZES;
}

/** A candidate's photo, or their initials on grey (never a broken image). */
export function CandidatePhoto({ candidateId, version, name, size = 'md' }: CandidatePhotoProps) {
  const url = usePhoto(candidateId, version);
  const box = `${SIZES[size]} shrink-0 rounded-lg`;
  if (url) return <img src={url} alt={`Photo of ${name}`} className={`${box} bg-slate-100 object-cover`} />;
  const label = url === undefined ? `Loading photo of ${name}` : `No photo of ${name}`;
  return (
    <div role="img" aria-label={label} className={`${box} flex items-center justify-center bg-slate-200 font-semibold text-slate-500`}>
      <bdi aria-hidden="true">{initials(name)}</bdi>
    </div>
  );
}
```

In `src/panel/CandidateCard.tsx`, add `import { CandidatePhoto } from '../photos/CandidatePhoto.tsx';` and replace:

```tsx
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">
            <span className="tabular-nums">#{candidate.number}</span> <bdi>{candidate.full_name}</bdi>
          </h2>
          <p className="text-sm text-slate-600">{details}</p>
        </div>
```

with:

```tsx
        <div className="flex min-w-0 items-start gap-3">
          <CandidatePhoto candidateId={candidate.id} version={candidate.photo_taken_at} name={candidate.full_name} />
          <div className="min-w-0">
            <h2 className="text-xl font-semibold">
              <span className="tabular-nums">#{candidate.number}</span> <bdi>{candidate.full_name}</bdi>
            </h2>
            <p className="text-sm text-slate-600">{details}</p>
          </div>
        </div>
```

In `src/app/StaffLayout.tsx`, change the React import to `import { useEffect, useState } from 'react';`, add `import { clearPhotoCache } from '../photos/usePhoto.ts';`, and add this right after `const [signedOutHere, setSignedOutHere] = useState(false);`:

```tsx
  // Photos are cached in memory only; the next person to sign in on this browser starts without them.
  useEffect(() => {
    if (state.status === 'signed_out') clearPhotoCache();
  }, [state.status]);
```

- [ ] **Step 4: Run the unit tests and the type check**

Run: `npm run test:unit && npm run typecheck`
Expected: everything passes, including the existing panel, application and results tests (their fixtures have no photo, so they show the placeholder). `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/photos/shrinkPhoto.ts src/photos/usePhoto.ts src/photos/CandidatePhoto.tsx src/panel/CandidateCard.tsx src/app/StaffLayout.tsx tests/unit/web/shrinkPhoto.test.ts tests/unit/web/candidatePhoto.test.tsx
git commit -m "feat(web): candidate photos on the card, shrunk before upload and cached until sign-out"
```

---

### Task 6: The capture view

**Files:**
- Create: `src/photos/CaptureView.tsx`
- Create: `tests/unit/web/captureView.test.tsx`

**Interfaces:**
- Consumes: Task 4's `Api.uploadPhoto`; Task 5's `shrinkPhoto`, `grabFrame`, `UNREADABLE_PHOTO` and `CandidatePhoto`.
- Produces: `<CaptureView candidate={{ id, number, name }} currentVersion={string | null} onSaved={(photoTakenAt: string) => void} onClose={() => void} />`.
  - It is a `dialog` named "Photo of #{number} {name}".
  - The file input is always present and labelled "Photo file", so E2E tests can set a file.
  - The preview is an `img` named "New photo of {name}".

- [ ] **Step 1: Write the failing tests**

`tests/unit/web/captureView.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/lib/api.ts';
import { ApiProvider } from '../../../src/lib/ApiProvider.tsx';
import { CaptureView } from '../../../src/photos/CaptureView.tsx';
import { shrinkPhoto, UNREADABLE_PHOTO } from '../../../src/photos/shrinkPhoto.ts';
import { clearPhotoCache } from '../../../src/photos/usePhoto.ts';
import { fakeApi } from './helpers.tsx';

vi.mock('../../../src/photos/shrinkPhoto.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/photos/shrinkPhoto.ts')>()),
  shrinkPhoto: vi.fn(async () => new Blob(['small jpeg'], { type: 'image/jpeg' })),
  grabFrame: vi.fn(),
}));

const photoFile = () => new File(['big photo'], 'photo.jpg', { type: 'image/jpeg' });

function renderCapture(api = fakeApi(), currentVersion: string | null = null) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <ApiProvider api={api}>
      <CaptureView candidate={{ id: 'c12', number: 12, name: 'Ali Khan' }} currentVersion={currentVersion} onSaved={onSaved} onClose={onClose} />
    </ApiProvider>,
  );
  return { api, onSaved, onClose, dialog: screen.getByRole('dialog', { name: 'Photo of #12 Ali Khan' }) };
}

function pretendToBeAPhone() {
  window.matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList);
}

describe('CaptureView', () => {
  beforeEach(() => {
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:${++n}`);
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    clearPhotoCache();
    // @ts-expect-error jsdom has no matchMedia; put it back the way it was
    delete window.matchMedia;
  });

  it('on a laptop without a camera, shrinks a chosen file, previews it and saves it', async () => {
    const { api, onSaved } = renderCapture();
    expect(await screen.findByText('No camera available here. Choose a photo file instead.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose a photo file' })).toBeInTheDocument();

    await userEvent.upload(screen.getByLabelText('Photo file'), photoFile());
    expect(await screen.findByRole('img', { name: 'New photo of Ali Khan' })).toHaveAttribute('src', 'blob:1');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(api.uploadPhoto).toHaveBeenCalledWith('c12', expect.any(Blob));
    expect(await (vi.mocked(api.uploadPhoto).mock.calls[0][1] as Blob).text()).toBe('small jpeg');
    expect(onSaved).toHaveBeenCalledWith('2026-09-26T10:05:00Z');
  });

  it('on a phone, one big button opens the back camera', async () => {
    pretendToBeAPhone();
    renderCapture();
    const input = screen.getByLabelText('Photo file');
    expect(input).toHaveAttribute('capture', 'environment');
    const click = vi.spyOn(input, 'click');
    await userEvent.click(screen.getByRole('button', { name: 'Take photo' }));
    expect(click).toHaveBeenCalled();
    expect(screen.queryByText(/No camera available/)).toBeNull();
  });

  it('keeps the photo after a failed save, and saving again works', async () => {
    const api = fakeApi({
      uploadPhoto: vi.fn().mockRejectedValueOnce(new ApiError('Candidate #12 is not waiting')).mockResolvedValueOnce('2026-09-26T10:06:00Z'),
    });
    const { onSaved } = renderCapture(api);
    await userEvent.upload(screen.getByLabelText('Photo file'), photoFile());
    await userEvent.click(await screen.findByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Candidate #12 is not waiting');
    expect(screen.getByRole('img', { name: 'New photo of Ali Khan' })).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('2026-09-26T10:06:00Z'));
    expect(api.uploadPhoto).toHaveBeenCalledTimes(2);
  });

  it('asks for another photo when the browser cannot read one', async () => {
    vi.mocked(shrinkPhoto).mockRejectedValueOnce(new Error(UNREADABLE_PHOTO));
    renderCapture();
    await userEvent.upload(screen.getByLabelText('Photo file'), photoFile());
    expect(await screen.findByRole('alert')).toHaveTextContent(UNREADABLE_PHOTO);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('Retake throws the preview away', async () => {
    renderCapture();
    await userEvent.upload(screen.getByLabelText('Photo file'), photoFile());
    await userEvent.click(await screen.findByRole('button', { name: 'Retake' }));
    expect(screen.queryByRole('img', { name: 'New photo of Ali Khan' })).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1');
    expect(screen.getByRole('button', { name: 'Choose a photo file' })).toBeInTheDocument();
  });

  it('shows the photo on file and offers a retake', async () => {
    pretendToBeAPhone();
    renderCapture(fakeApi(), '2026-09-26T09:30:00Z');
    expect(await screen.findByRole('img', { name: 'Photo of Ali Khan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retake photo' })).toBeInTheDocument();
  });

  it('closes with Close or Escape', async () => {
    const { onClose } = renderCapture();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/unit/web/captureView.test.tsx`
Expected: FAIL with `Failed to resolve import "../../../src/photos/CaptureView.tsx"`.

- [ ] **Step 3: Write the capture view**

`src/photos/CaptureView.tsx`:

```tsx
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { buttonClasses } from '../components/ActionButton.tsx';
import { errorMessage } from '../lib/api.ts';
import { useApi } from '../lib/ApiProvider.tsx';
import { CandidatePhoto } from './CandidatePhoto.tsx';
import { grabFrame, shrinkPhoto } from './shrinkPhoto.ts';

export interface CaptureCandidate {
  id: string;
  number: number;
  name: string;
}

interface CaptureViewProps {
  candidate: CaptureCandidate;
  /** photo_taken_at of the photo on file, shown until a new one is taken; null = none. */
  currentVersion: string | null;
  onSaved: (photoTakenAt: string) => void;
  onClose: () => void;
}

type Camera = 'starting' | 'on' | 'unavailable';

/** A touch screen: use the phone's own camera app. A mouse: a webcam preview, or a file. */
const isPhone = () => typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

/** Take (or retake) one candidate's photo: camera or file → shrunk preview → Save. */
export function CaptureView({ candidate, currentVersion, onSaved, onClose }: CaptureViewProps) {
  const api = useApi();
  const [phone] = useState(isPhone);
  const fileInput = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<Camera>('starting');
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState<'reading' | 'saving' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const who = `#${candidate.number} ${candidate.name}`;

  // A laptop's webcam runs only while no photo is on screen; phones use their own camera app instead.
  useEffect(() => {
    if (phone || photo) return;
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) {
      setCamera('unavailable');
      return;
    }
    let stream: MediaStream | null = null;
    let cancelled = false;
    setCamera('starting');
    media.getUserMedia({ video: { facingMode: 'user' }, audio: false }).then(
      (s) => {
        if (cancelled) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = s;
        if (video.current) video.current.srcObject = s;
        setCamera('on');
      },
      () => {
        if (!cancelled) setCamera('unavailable');
      },
    );
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [phone, photo]);

  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo.url);
    },
    [photo],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && busy !== 'saving') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  async function takeFrom(source: Promise<Blob>) {
    setBusy('reading');
    setError(null);
    setSaveFailed(false);
    try {
      const blob = await shrinkPhoto(await source);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // choosing the same file again still counts
    if (file) void takeFrom(Promise.resolve(file));
  }

  function retake() {
    setPhoto(null);
    setError(null);
    setSaveFailed(false);
    if (phone) fileInput.current?.click();
  }

  async function save() {
    if (!photo) return;
    setBusy('saving');
    setError(null);
    try {
      onSaved(await api.uploadPhoto(candidate.id, photo.blob));
    } catch (e) {
      setError(errorMessage(e));
      setSaveFailed(true);
      setBusy(null);
    }
  }

  const big = `${buttonClasses('primary', 'md')} h-14 text-lg`;
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-900/60 sm:items-center sm:p-6">
      <div role="dialog" aria-modal="true" aria-label={`Photo of ${who}`} className="flex w-full flex-col gap-4 overflow-y-auto bg-white p-4 sm:max-w-lg sm:rounded-xl sm:shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-2xl font-bold">
            <span className="tabular-nums">#{candidate.number}</span> <bdi>{candidate.name}</bdi>
          </h2>
          <button type="button" className={buttonClasses('ghost', 'md')} disabled={busy === 'saving'} onClick={onClose}>
            Close
          </button>
        </div>

        {photo ? (
          <img src={photo.url} alt={`New photo of ${candidate.name}`} className="max-h-[60vh] w-full rounded-lg object-contain" />
        ) : (
          <>
            {currentVersion && <CandidatePhoto candidateId={candidate.id} version={currentVersion} name={candidate.name} size="xl" />}
            {!phone && camera !== 'unavailable' && (
              <video ref={video} autoPlay playsInline muted aria-label="Camera preview" className="w-full rounded-lg bg-slate-900" />
            )}
            {!phone && camera === 'unavailable' && <p className="text-sm text-slate-600">No camera available here. Choose a photo file instead.</p>}
          </>
        )}

        {error && (
          <p role="alert" className="text-sm font-medium text-red-700">
            {error}
          </p>
        )}

        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          capture={phone ? 'environment' : undefined}
          aria-label="Photo file"
          tabIndex={-1}
          className="sr-only"
          onChange={onFile}
        />

        <div className="flex flex-col gap-2">
          {photo ? (
            <>
              <button type="button" className={big} disabled={busy !== null} onClick={() => void save()}>
                {busy === 'saving' ? 'Saving…' : saveFailed ? 'Try again' : 'Save'}
              </button>
              <button type="button" className={buttonClasses('secondary', 'md')} disabled={busy !== null} onClick={retake}>
                Retake
              </button>
            </>
          ) : phone ? (
            <button type="button" className={big} disabled={busy !== null} onClick={() => fileInput.current?.click()}>
              {busy === 'reading' ? 'Preparing…' : currentVersion ? 'Retake photo' : 'Take photo'}
            </button>
          ) : (
            <>
              {camera === 'on' && (
                <button type="button" className={big} disabled={busy !== null} onClick={() => video.current && void takeFrom(grabFrame(video.current))}>
                  {busy === 'reading' ? 'Preparing…' : 'Capture'}
                </button>
              )}
              <button type="button" className={buttonClasses('secondary', 'md')} disabled={busy !== null} onClick={() => fileInput.current?.click()}>
                {camera === 'unavailable' ? 'Choose a photo file' : 'Choose a file instead'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests and the type check**

Run: `npx vitest run tests/unit/web/captureView.test.tsx && npm run typecheck`
Expected: every `CaptureView` test passes, and `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/photos/CaptureView.tsx tests/unit/web/captureView.test.tsx
git commit -m "feat(web): capture view: phone camera, laptop webcam or file, preview, save and retry"
```

---

### Task 7: The photographer's screen

**Files:**
- Create: `src/photos/photoQueueView.ts`
- Create: `src/photos/PhotosPage.tsx`
- Create: `tests/unit/web/photoQueueView.test.ts`
- Create: `tests/unit/web/photosPage.test.tsx`
- Modify: `src/app/routes.tsx`
- Modify: `src/app/StaffLayout.tsx` (`NAV`)
- Modify: `tests/unit/web/fixtures.ts` (`photoEntry`)
- Modify: `tests/unit/web/routing.test.tsx`

**Interfaces:**
- Consumes: Task 4's `Api.photoQueue`, `Api.subscribeBoard` and `PhotoQueueEntry`; Task 5's `CandidatePhoto`; Task 6's `CaptureView`; `useLiveSnapshot`, `ConnectionBanner` and `FullPageMessage`.
- Produces:
  - `matchesPhotoSearch(entry, query)`, `photoLists(entries, query?) → { needs, done }` and `photoCounts(entries) → { needs, done }`;
  - the route `/photos` (photographer and admin);
  - the `Photos` nav link;
  - the fixture helper `photoEntry(number, name, overrides?)`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/web/fixtures.ts` (and add `PhotoQueueEntry` to its type import):

```ts
/** One waiting candidate on the photographer's list; no photo unless overridden. */
export function photoEntry(number: number, name: string, overrides: Partial<PhotoQueueEntry> = {}): PhotoQueueEntry {
  return { candidate_id: `c${number}`, number, name, checked_in_at: '2026-09-26T09:00:00Z', photo_taken_at: null, ...overrides };
}
```

`tests/unit/web/photoQueueView.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { matchesPhotoSearch, photoCounts, photoLists } from '../../../src/photos/photoQueueView.ts';
import { photoEntry } from './fixtures.ts';

const entries = [
  photoEntry(13, 'Hina Malik', { checked_in_at: '2026-09-26T09:05:00Z' }),
  photoEntry(12, 'Ali Khan', { checked_in_at: '2026-09-26T09:00:00Z' }),
  photoEntry(20, 'Bilal Raza', { checked_in_at: '2026-09-26T08:50:00Z', photo_taken_at: '2026-09-26T09:10:00Z' }),
  photoEntry(21, 'Sana Ali', { checked_in_at: '2026-09-26T08:55:00Z', photo_taken_at: '2026-09-26T09:20:00.123456+00:00' }),
];

describe('photoLists', () => {
  it('puts people without a photo first-come first-served, and the latest photos first', () => {
    const { needs, done } = photoLists(entries);
    expect(needs.map((e) => e.number)).toEqual([12, 13]);
    expect(done.map((e) => e.number)).toEqual([21, 20]);
  });

  it('finds people by number (with or without #) or by part of their name', () => {
    expect(photoLists(entries, '#12').needs.map((e) => e.number)).toEqual([12]);
    expect(photoLists(entries, '2').done.map((e) => e.number)).toEqual([21, 20]);
    expect(photoLists(entries, ' ALI ').needs.map((e) => e.number)).toEqual([12]);
    expect(photoLists(entries, ' ALI ').done.map((e) => e.number)).toEqual([21]);
    expect(matchesPhotoSearch(entries[0], '')).toBe(true);
  });
});

describe('photoCounts', () => {
  it('counts everyone waiting, whatever the search', () => {
    expect(photoCounts(entries)).toEqual({ needs: 2, done: 2 });
    expect(photoCounts([])).toEqual({ needs: 0, done: 0 });
  });
});
```

`tests/unit/web/photosPage.test.tsx`:

```tsx
// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../../../src/lib/api.ts';
import { clearPhotoCache } from '../../../src/photos/usePhoto.ts';
import { photoEntry, profile } from './fixtures.ts';
import { fakeApi, fakeAuth, renderApp } from './helpers.tsx';

vi.mock('../../../src/photos/shrinkPhoto.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/photos/shrinkPhoto.ts')>()),
  shrinkPhoto: vi.fn(async () => new Blob(['small jpeg'], { type: 'image/jpeg' })),
}));

const waiting = [
  photoEntry(13, 'Hina Malik', { checked_in_at: '2026-09-26T09:05:00Z' }),
  photoEntry(12, 'Ali Khan', { checked_in_at: '2026-09-26T09:00:00Z' }),
  photoEntry(20, 'Bilal Raza', { photo_taken_at: '2026-09-26T09:10:00Z' }),
];

async function openPhotos(api: Api = fakeApi({ photoQueue: vi.fn(async () => waiting) })) {
  const view = renderApp('/photos', { api, auth: fakeAuth({ signedInAs: profile('photographer') }).backend });
  await screen.findByRole('heading', { name: 'Photos', level: 1 });
  return { ...view, api };
}

describe('PhotosPage', () => {
  beforeEach(() => {
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:${++n}`);
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => clearPhotoCache());

  it('lists who needs a photo and who is done, with the counts', async () => {
    await openPhotos();
    expect(screen.getByText('2 need photo · 1 done')).toBeInTheDocument();
    const needs = screen.getByRole('list', { name: 'Needs photo' });
    expect(within(needs).getAllByRole('button').map((b) => b.textContent)).toEqual(['#12 Ali Khan', '#13 Hina Malik']);
    const done = screen.getByRole('list', { name: 'Done' });
    expect(within(done).getByRole('button', { name: /#20 Bilal Raza/ })).toBeInTheDocument();
    expect(document.title).toBe('Photos · MLSA Induction');
    expect(screen.queryByRole('navigation', { name: 'Screens' })).toBeNull(); // one screen, no links
  });

  it('finds people by number or name', async () => {
    await openPhotos();
    const search = screen.getByRole('searchbox', { name: 'Find a candidate' });
    await userEvent.type(search, '13');
    expect(within(screen.getByRole('list', { name: 'Needs photo' })).getAllByRole('button')).toHaveLength(1);
    expect(screen.getAllByText('Nobody here matches.')).toHaveLength(1); // Done
    await userEvent.clear(search);
    await userEvent.type(search, 'bil');
    expect(screen.getByText('Nobody here matches.')).toBeInTheDocument(); // Needs photo
    expect(within(screen.getByRole('list', { name: 'Done' })).getByRole('button', { name: /Bilal Raza/ })).toBeInTheDocument();
  });

  it('reloads when the board changes (someone checked in or sent in)', async () => {
    const { api } = await openPhotos();
    const before = vi.mocked(api.photoQueue).mock.calls.length;
    (api as ReturnType<typeof fakeApi>).topics.board.event();
    await waitFor(() => expect(vi.mocked(api.photoQueue).mock.calls.length).toBeGreaterThan(before));
  });

  it('opens the capture view for the person tapped, and reloads after saving', async () => {
    const { api } = await openPhotos();
    await userEvent.click(within(screen.getByRole('list', { name: 'Needs photo' })).getByRole('button', { name: '#12 Ali Khan' }));
    const dialog = screen.getByRole('dialog', { name: 'Photo of #12 Ali Khan' });
    const before = vi.mocked(api.photoQueue).mock.calls.length;
    await userEvent.upload(within(dialog).getByLabelText('Photo file'), new File(['x'], 'x.jpg', { type: 'image/jpeg' }));
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Save' }));
    expect(api.uploadPhoto).toHaveBeenCalledWith('c12', expect.any(Blob));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(vi.mocked(api.photoQueue).mock.calls.length).toBeGreaterThan(before));
  });

  it('says so when nobody is waiting', async () => {
    await openPhotos(fakeApi({ photoQueue: vi.fn(async () => []) }));
    expect(screen.getByText('0 need photo · 0 done')).toBeInTheDocument();
    expect(screen.getByText('Nobody is waiting.')).toBeInTheDocument();
    expect(screen.getByText('No photos yet.')).toBeInTheDocument();
  });

  it('says so when everyone waiting has a photo', async () => {
    await openPhotos(fakeApi({ photoQueue: vi.fn(async () => [photoEntry(20, 'Bilal Raza', { photo_taken_at: '2026-09-26T09:10:00Z' })]) }));
    expect(screen.getByText('Everyone waiting has a photo.')).toBeInTheDocument();
  });

  it('keeps other roles out', async () => {
    renderApp('/photos', { auth: fakeAuth({ signedInAs: profile('queue_manager') }).backend });
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
  });
});
```

In `tests/unit/web/routing.test.tsx`:
- Add `photos: { password: 'right-password', profile: profile('photographer') },` to `accounts`.
- Change `expect(nav).toHaveTextContent('QueuePanelResultsAdmin');` to `expect(nav).toHaveTextContent('QueuePanelPhotosResultsAdmin');`.
- Add this test inside the `describe`:

```tsx
  it('sends a photographer to /photos and keeps them off the queue', async () => {
    const { router } = renderApp('/login', { auth: fakeAuth({ accounts }).backend });
    await signIn('photos');
    await waitFor(() => expect(router.state.location.pathname).toBe('/photos'));
    await router.navigate('/queue');
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/unit/web/photoQueueView.test.ts tests/unit/web/photosPage.test.tsx tests/unit/web/routing.test.tsx`
Expected: FAIL.
- `photoQueueView.ts` can't be resolved.
- `/photos` renders "Page not found".
- The nav reads `QueuePanelResultsAdmin`.

- [ ] **Step 3: Write the view model, the page, the route and the nav link**

`src/photos/photoQueueView.ts`:

```ts
import { parseServerTime } from '../lib/clock.ts';
import type { PhotoQueueEntry } from '../lib/types.ts';

export interface PhotoLists {
  needs: PhotoQueueEntry[];
  done: PhotoQueueEntry[];
}

/** "12", "#12" (numbers starting with those digits) or part of a name. An empty search matches everyone. */
export function matchesPhotoSearch(entry: PhotoQueueEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = /^#?(\d+)$/.exec(q);
  if (digits) return String(entry.number).startsWith(digits[1]);
  return entry.name.toLowerCase().includes(q);
}

const time = (iso: string | null) => (iso ? parseServerTime(iso) : 0);

/** Needs photo: earliest check-in first. Done: most recent photo first (the one just taken is on top). */
export function photoLists(entries: PhotoQueueEntry[], query = ''): PhotoLists {
  const shown = entries.filter((entry) => matchesPhotoSearch(entry, query));
  return {
    needs: shown
      .filter((entry) => !entry.photo_taken_at)
      .sort((a, b) => time(a.checked_in_at) - time(b.checked_in_at) || a.number - b.number),
    done: shown
      .filter((entry) => entry.photo_taken_at)
      .sort((a, b) => time(b.photo_taken_at) - time(a.photo_taken_at) || a.number - b.number),
  };
}

/** Across everyone waiting, whatever the search. */
export function photoCounts(entries: PhotoQueueEntry[]): { needs: number; done: number } {
  const done = entries.filter((entry) => entry.photo_taken_at).length;
  return { needs: entries.length - done, done };
}
```

`src/photos/PhotosPage.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { buttonClasses } from '../components/ActionButton.tsx';
import { ConnectionBanner } from '../components/ConnectionBanner.tsx';
import { FullPageMessage } from '../components/FullPageMessage.tsx';
import { useApi } from '../lib/ApiProvider.tsx';
import type { PhotoQueueEntry } from '../lib/types.ts';
import { useLiveSnapshot } from '../lib/useLiveSnapshot.ts';
import { CandidatePhoto } from './CandidatePhoto.tsx';
import { CaptureView } from './CaptureView.tsx';
import { photoCounts, photoLists } from './photoQueueView.ts';

/** /photos: the photographer's one screen (admins can open it too). Built for a phone. */
export function PhotosPage() {
  const api = useApi();
  const subscribe = useMemo(() => api.subscribeBoard(), [api]);
  const { data: entries, error, status, reload } = useLiveSnapshot(api.photoQueue, subscribe);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<PhotoQueueEntry | null>(null);

  useEffect(() => {
    document.title = 'Photos · MLSA Induction';
  }, []);

  if (!entries) {
    return (
      <FullPageMessage title={error ? "Couldn't load the list" : 'Loading the list…'}>
        {error && (
          <>
            <p>{error}</p>
            <button type="button" className={`${buttonClasses('secondary', 'md')} mt-3`} onClick={reload}>
              Try again
            </button>
          </>
        )}
      </FullPageMessage>
    );
  }

  const counts = photoCounts(entries);
  const lists = photoLists(entries, query);
  const searching = query.trim() !== '';
  return (
    <>
      <ConnectionBanner status={status} />
      <main className="mx-auto max-w-xl space-y-4 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold">Photos</h1>
          <p className="text-sm font-medium text-slate-700">
            {counts.needs} need photo · {counts.done} done
          </p>
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            Couldn't refresh the list: {error}
          </p>
        )}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Find a candidate"
          placeholder="Number or name"
          className="h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-base"
        />
        <PhotoSection
          title="Needs photo"
          entries={lists.needs}
          empty={searching ? 'Nobody here matches.' : entries.length === 0 ? 'Nobody is waiting.' : 'Everyone waiting has a photo.'}
          onOpen={setOpen}
        />
        <PhotoSection title="Done" entries={lists.done} empty={searching ? 'Nobody here matches.' : 'No photos yet.'} onOpen={setOpen} withPhotos />
      </main>
      {open && (
        <CaptureView
          candidate={{ id: open.candidate_id, number: open.number, name: open.name }}
          currentVersion={open.photo_taken_at}
          onSaved={() => {
            setOpen(null);
            reload();
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

interface PhotoSectionProps {
  title: string;
  entries: PhotoQueueEntry[];
  empty: string;
  onOpen: (entry: PhotoQueueEntry) => void;
  withPhotos?: boolean;
}

function PhotoSection({ title, entries, empty, onOpen, withPhotos = false }: PhotoSectionProps) {
  const id = `photos-${title.toLowerCase().replace(/\W+/g, '-')}`;
  return (
    <section aria-labelledby={id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <h2 id={id} className="border-b border-slate-100 px-4 py-2 text-sm font-semibold tracking-wide text-slate-600 uppercase">
        {title}
      </h2>
      {entries.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">{empty}</p>
      ) : (
        <ul aria-label={title} className="divide-y divide-slate-100">
          {entries.map((entry) => (
            <li key={entry.candidate_id}>
              <button
                type="button"
                onClick={() => onOpen(entry)}
                className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50 active:bg-slate-100"
              >
                {withPhotos && <CandidatePhoto candidateId={entry.candidate_id} version={entry.photo_taken_at} name={entry.name} size="sm" />}
                <span className="text-lg font-semibold tabular-nums">#{entry.number}</span> <bdi className="min-w-0 flex-1 truncate text-base">{entry.name}</bdi>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

In `src/app/routes.tsx`, add `import { PhotosPage } from '../photos/PhotosPage.tsx';` and, after the `panel` route:

```tsx
      { path: 'photos', element: <RequireRole roles={['photographer', 'admin']}><PhotosPage /></RequireRole> },
```

In `src/app/StaffLayout.tsx`, add to `NAV` after the Panel entry:

```ts
  { to: '/photos', label: 'Photos', roles: ['photographer', 'admin'] },
```

- [ ] **Step 4: Run the unit tests and the type check**

Run: `npm run test:unit && npm run typecheck`
Expected: everything passes, and `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/photos/photoQueueView.ts src/photos/PhotosPage.tsx src/app/routes.tsx src/app/StaffLayout.tsx tests/unit/web/fixtures.ts tests/unit/web/photoQueueView.test.ts tests/unit/web/photosPage.test.tsx tests/unit/web/routing.test.tsx
git commit -m "feat(web): /photos: the photographer's list of who needs a photo, live, phone-first"
```

---

### Task 8: The queue manager: camera icon and "no photo yet" at Send in

**Files:**
- Create: `src/queue/PhotoFlow.tsx`
- Create: `tests/unit/web/queuePhotos.test.tsx`
- Modify: `src/queue/PoolList.tsx`
- Modify: `src/queue/PanelCard.tsx`
- Modify: `src/queue/QueuePage.tsx`
- Modify: `tests/unit/web/panelCard.test.tsx`

**Interfaces:**
- Consumes: Task 4's `LaneEntry.has_photo`, `Api.sendIn` and `Api.uploadPhoto`; Task 6's `CaptureView`; `useRunAction` (inside `ActionProvider`).
- Produces:
  - `<PhotoFlowProvider>` (inside `ActionProvider`);
  - `usePhotoFlow(): { sendIn(entry, panel: { id; name }): Promise<unknown>; takePhoto(entry): void }`;
  - `<NoPhotoButton entry />` (a button named "Take a photo of #N");
  - the alertdialog "No photo yet".

- [ ] **Step 1: Write the failing tests**

`tests/unit/web/queuePhotos.test.tsx`:

```tsx
// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LaneEntry } from '../../../src/lib/types.ts';
import { board, boardPanel, lane } from './fixtures.ts';
import { fakeApi, fakeAuth, renderApp } from './helpers.tsx';

vi.mock('../../../src/photos/shrinkPhoto.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/photos/shrinkPhoto.ts')>()),
  shrinkPhoto: vi.fn(async () => new Blob(['small jpeg'], { type: 'image/jpeg' })),
}));

const queueManager = () =>
  fakeAuth({ signedInAs: { id: 'u-queue', username: 'queue', display_name: 'Queue', role: 'queue_manager', is_active: true, current_panel_id: null } });

const withoutPhoto = (entries: LaneEntry[], ...numbers: number[]) =>
  entries.map((e) => (numbers.includes(e.number) ? { ...e, has_photo: false } : e));

/** Panel 2 is free; #20 in the pool has no photo, #21 has one. */
async function openQueue(snapshot = board({ pool: withoutPhoto(lane([20, 'Bilal Khan'], [21, 'Hina Malik']), 20) })) {
  const api = fakeApi({ boardSnapshot: vi.fn(async () => snapshot) });
  renderApp('/queue', { api, auth: queueManager().backend });
  const pool = await screen.findByRole('list', { name: 'Waiting pool' });
  const [first, second] = within(pool).getAllByRole('listitem');
  return { api, first, second };
}

describe('photos on the queue board', () => {
  beforeEach(() => {
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:${++n}`);
    URL.revokeObjectURL = vi.fn();
  });

  it('marks who has no photo yet', async () => {
    const { first, second } = await openQueue();
    expect(within(first).getByRole('button', { name: 'Take a photo of #20' })).toBeInTheDocument();
    expect(within(second).queryByRole('button', { name: /Take a photo/ })).toBeNull();
  });

  it('asks before sending in someone without a photo, and can send them anyway', async () => {
    const { api, first } = await openQueue();
    await userEvent.click(within(first).getByRole('button', { name: 'Send in → Panel 2' }));
    const question = screen.getByRole('alertdialog', { name: 'No photo yet' });
    expect(question).toHaveTextContent('#20 Bilal Khan has no photo yet.');
    expect(api.sendIn).not.toHaveBeenCalled();

    await userEvent.click(within(question).getByRole('button', { name: 'Send without photo' }));
    expect(api.sendIn).toHaveBeenCalledWith('c20', 'p2');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('Cancel sends nobody in', async () => {
    const { api, first } = await openQueue();
    await userEvent.click(within(first).getByRole('button', { name: 'Send in → Panel 2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.sendIn).not.toHaveBeenCalled();
  });

  it('Take photo saves the photo, then carries on with the send-in', async () => {
    const { api, first } = await openQueue();
    await userEvent.click(within(first).getByRole('button', { name: 'Send in → Panel 2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Take photo' }));
    const capture = screen.getByRole('dialog', { name: 'Photo of #20 Bilal Khan' });
    await userEvent.upload(within(capture).getByLabelText('Photo file'), new File(['x'], 'x.jpg', { type: 'image/jpeg' }));
    await userEvent.click(await within(capture).findByRole('button', { name: 'Save' }));

    expect(api.uploadPhoto).toHaveBeenCalledWith('c20', expect.any(Blob));
    await waitFor(() => expect(api.sendIn).toHaveBeenCalledWith('c20', 'p2'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sends someone with a photo straight in', async () => {
    const { api, second } = await openQueue();
    await userEvent.click(within(second).getByRole('button', { name: 'Send in → Panel 2' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.sendIn).toHaveBeenCalledWith('c21', 'p2');
  });

  it("asks for the first in a panel's line too", async () => {
    const snapshot = board({ panels: [boardPanel('p2', 'Panel 2', { is_default: true, lane: withoutPhoto(lane([12, 'Ali Raza']), 12) })], pool: [] });
    renderApp('/queue', { api: fakeApi({ boardSnapshot: vi.fn(async () => snapshot) }), auth: queueManager().backend });
    const card = await screen.findByRole('region', { name: 'Panel 2' });
    expect(within(card).getByRole('button', { name: 'Take a photo of #12' })).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Send #12 in to Panel 2' }));
    expect(screen.getByRole('alertdialog', { name: 'No photo yet' })).toHaveTextContent('#12 Ali Raza has no photo yet.');
  });

  it('the camera button takes a photo without sending anyone in', async () => {
    const { api, first } = await openQueue();
    await userEvent.click(within(first).getByRole('button', { name: 'Take a photo of #20' }));
    const capture = screen.getByRole('dialog', { name: 'Photo of #20 Bilal Khan' });
    await userEvent.upload(within(capture).getByLabelText('Photo file'), new File(['x'], 'x.jpg', { type: 'image/jpeg' }));
    await userEvent.click(await within(capture).findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.uploadPhoto).toHaveBeenCalledWith('c20', expect.any(Blob)));
    expect(api.sendIn).not.toHaveBeenCalled();
  });
});
```

In `tests/unit/web/panelCard.test.tsx`, add `import { PhotoFlowProvider } from '../../../src/queue/PhotoFlow.tsx';` and wrap the card in `renderCard`:

```tsx
          <ActionProvider>
            <PhotoFlowProvider>
              <PanelCard panel={panel} targetMinutes={15} role={role} />
            </PhotoFlowProvider>
          </ActionProvider>
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/unit/web/queuePhotos.test.tsx tests/unit/web/panelCard.test.tsx`
Expected: FAIL with `Failed to resolve import "../../../src/queue/PhotoFlow.tsx"`.

- [ ] **Step 3: Write the photo flow and wire it into the board**

`src/queue/PhotoFlow.tsx`:

```tsx
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { buttonClasses } from '../components/ActionButton.tsx';
import { useRunAction } from '../components/ActionProvider.tsx';
import { useApi } from '../lib/ApiProvider.tsx';
import type { LaneEntry } from '../lib/types.ts';
import { CaptureView } from '../photos/CaptureView.tsx';

interface PanelRef {
  id: string;
  name: string;
}

interface SendTarget {
  entry: LaneEntry;
  panel: PanelRef;
}

interface PhotoFlow {
  /** Sends the person in, or first asks what to do when they have no photo yet. */
  sendIn(entry: LaneEntry, panel: PanelRef): Promise<unknown>;
  takePhoto(entry: LaneEntry): void;
}

const PhotoFlowContext = createContext<PhotoFlow | null>(null);

export function usePhotoFlow(): PhotoFlow {
  const flow = useContext(PhotoFlowContext);
  if (!flow) throw new Error('usePhotoFlow() must be used inside <PhotoFlowProvider>');
  return flow;
}

/** The queue board's photo steps: the "no photo yet" question at Send in, and the capture view. Goes inside ActionProvider. */
export function PhotoFlowProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const run = useRunAction();
  const [asking, setAsking] = useState<SendTarget | null>(null);
  const [capturing, setCapturing] = useState<{ entry: LaneEntry; thenSend: SendTarget | null } | null>(null);

  const flow = useMemo<PhotoFlow>(
    () => ({
      async sendIn(entry, panel) {
        if (entry.has_photo) return api.sendIn(entry.candidate_id, panel.id);
        setAsking({ entry, panel });
      },
      takePhoto: (entry) => setCapturing({ entry, thenSend: null }),
    }),
    [api],
  );

  const send = (target: SendTarget) => void run(() => api.sendIn(target.entry.candidate_id, target.panel.id));

  return (
    <PhotoFlowContext.Provider value={flow}>
      {children}
      {asking && (
        <NoPhotoDialog
          target={asking}
          onTakePhoto={() => {
            setCapturing({ entry: asking.entry, thenSend: asking });
            setAsking(null);
          }}
          onSendAnyway={() => {
            setAsking(null);
            send(asking);
          }}
          onCancel={() => setAsking(null)}
        />
      )}
      {capturing && (
        <CaptureView
          candidate={{ id: capturing.entry.candidate_id, number: capturing.entry.number, name: capturing.entry.name }}
          currentVersion={null}
          onSaved={() => {
            setCapturing(null);
            if (capturing.thenSend) send(capturing.thenSend);
          }}
          onClose={() => setCapturing(null)}
        />
      )}
    </PhotoFlowContext.Provider>
  );
}

interface NoPhotoDialogProps {
  target: SendTarget;
  onTakePhoto: () => void;
  onSendAnyway: () => void;
  onCancel: () => void;
}

function NoPhotoDialog({ target, onTakePhoto, onSendAnyway, onCancel }: NoPhotoDialogProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div role="alertdialog" aria-modal="true" aria-labelledby="no-photo-title" aria-describedby="no-photo-text" className="w-full max-w-sm space-y-4 rounded-xl bg-white p-5 shadow-xl">
        <h2 id="no-photo-title" className="text-lg font-semibold">
          No photo yet
        </h2>
        <p id="no-photo-text" className="text-sm text-slate-700">
          <span className="tabular-nums">#{target.entry.number}</span> <bdi>{target.entry.name}</bdi> has no photo yet. Take one now, or send
          them in to {target.panel.name} without it?
        </p>
        <div className="flex flex-col gap-2">
          <button type="button" autoFocus className={buttonClasses('primary', 'md')} onClick={onTakePhoto}>
            Take photo
          </button>
          <button type="button" className={buttonClasses('secondary', 'md')} onClick={onSendAnyway}>
            Send without photo
          </button>
          <button type="button" className={buttonClasses('ghost', 'md')} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** The camera button next to a name in the pool or a panel's line, for people without a photo. */
export function NoPhotoButton({ entry }: { entry: LaneEntry }) {
  const { takePhoto } = usePhotoFlow();
  return (
    <button
      type="button"
      onClick={() => takePhoto(entry)}
      aria-label={`Take a photo of #${entry.number}`}
      title="No photo yet"
      className="shrink-0 rounded-md p-1 text-amber-700 hover:bg-amber-50"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
        <circle cx="12" cy="13" r="3" />
        <path d="M3 3l18 18" />
      </svg>
    </button>
  );
}
```

In `src/queue/PoolList.tsx`:
- Add `import { NoPhotoButton, usePhotoFlow } from './PhotoFlow.tsx';`.
- In `PoolList`, add `const { sendIn } = usePhotoFlow();` after `const api = useApi();`.
- After `<CandidateName number={entry.number} name={entry.name} className="flex-1 font-medium" />`, add `{!entry.has_photo && <NoPhotoButton entry={entry} />}`.
- Change the Send in button's action to `action={() => sendIn(entry, panel)}`.

In `src/queue/PanelCard.tsx`:
- Add `import { NoPhotoButton, usePhotoFlow } from './PhotoFlow.tsx';`.
- Add `const { sendIn } = usePhotoFlow();` after `const api = useApi();`.
- In the lane row, after `<CandidateName number={entry.number} name={entry.name} className="flex-1 font-medium" />`, add `{!entry.has_photo && <NoPhotoButton entry={entry} />}`.
- Change the Send in button's action to `action={() => sendIn(entry, panel)}`.

In `src/queue/QueuePage.tsx`, add `import { PhotoFlowProvider } from './PhotoFlow.tsx';` and replace the final `return (…);` of `QueuePage` with:

```tsx
  return (
    <ActionProvider onSettled={reload}>
      <PhotoFlowProvider>
        <ConnectionBanner status={status} />
        <TopBar board={board} onImport={() => setImporting(true)} onShowList={openList} canReadForms={role === 'admin'} />
        {error && (
          <p role="alert" className="bg-red-50 px-4 py-2 text-sm text-red-800">
            Couldn't refresh the board: {error}
          </p>
        )}
        <main className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
          <div className="grid content-start gap-4 lg:grid-cols-2">
            {board.panels.map((panel) => (
              <PanelCard key={panel.id} panel={panel} targetMinutes={board.induction.target_interview_minutes} role={role} />
            ))}
          </div>
          <PoolList board={board} />
        </main>
        {importing && <ImportDialog onClose={() => setImporting(false)} />}
        {listFilter && (
          <CandidateListDialog board={board} filter={listFilter} onFilterChange={openList} onClose={closeList} canReadForms={role === 'admin'} />
        )}
      </PhotoFlowProvider>
    </ActionProvider>
  );
```

- [ ] **Step 4: Run the unit tests and the type check**

Run: `npm run test:unit && npm run typecheck`
Expected: everything passes, including the existing queue page and panel card tests (their fixtures have photos). `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/queue/PhotoFlow.tsx src/queue/PoolList.tsx src/queue/PanelCard.tsx src/queue/QueuePage.tsx tests/unit/web/queuePhotos.test.tsx tests/unit/web/panelCard.test.tsx
git commit -m "feat(web): queue board marks missing photos and asks at Send in: take one, send anyway or cancel"
```

---

### Task 9: Admin: Delete all photos, and a dev photographer account

**Files:**
- Create: `src/admin/PhotosSection.tsx`
- Create: `tests/unit/web/photosSection.test.tsx`
- Modify: `src/admin/AdminPage.tsx`
- Modify: `scripts/seed-dev.ts`

**Interfaces:**
- Consumes: Task 4's `Api.photoCount` and `Api.deleteAllPhotos`, `ROLES`/`ROLE_LABELS` (the Accounts role picker already maps `ROLES`).
- Produces:
  - `<PhotosSection />`: a region named "Photos" on `/admin`;
  - the dev account `photos` (photographer, password `induction-dev`), which Task 10 uses.

- [ ] **Step 1: Write the failing tests**

`tests/unit/web/photosSection.test.tsx`:

```tsx
// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../../../src/lib/api.ts';
import { profile } from './fixtures.ts';
import { fakeApi, fakeAuth, renderApp } from './helpers.tsx';

async function openAdmin(api: Api) {
  renderApp('/admin', { api, auth: fakeAuth({ signedInAs: profile('admin') }).backend });
  return screen.findByRole('region', { name: 'Photos' });
}

describe('Photos on the admin page', () => {
  afterEach(() => vi.restoreAllMocks());

  it('deletes every photo after asking, then shows none left', async () => {
    const api = fakeApi({ photoCount: vi.fn().mockResolvedValueOnce(3).mockResolvedValue(0), deleteAllPhotos: vi.fn(async () => 3) });
    const section = await openAdmin(api);
    expect(await within(section).findByText(/3 photos stored\./)).toBeInTheDocument();

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    await userEvent.click(within(section).getByRole('button', { name: 'Delete all photos' }));
    expect(confirm).toHaveBeenLastCalledWith("Delete all 3 photos? This can't be undone.");
    expect(api.deleteAllPhotos).not.toHaveBeenCalled();

    await userEvent.click(within(section).getByRole('button', { name: 'Delete all photos' }));
    expect(api.deleteAllPhotos).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Deleted 3 photos.')).toBeInTheDocument();
    await waitFor(() => expect(within(section).getByText(/0 photos stored\./)).toBeInTheDocument());
    expect(within(section).getByRole('button', { name: 'Delete all photos' })).toBeDisabled();
  });

  it('says one photo, not one photos', async () => {
    const section = await openAdmin(fakeApi({ photoCount: vi.fn(async () => 1) }));
    expect(await within(section).findByText(/1 photo stored\./)).toBeInTheDocument();
  });

  it('offers the Photographer role for new accounts', async () => {
    await openAdmin(fakeApi());
    const role = screen.getByRole('combobox', { name: 'Role' });
    expect(within(role).getByRole('option', { name: 'Photographer' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/unit/web/photosSection.test.tsx`
Expected: FAIL. `findByRole('region', { name: 'Photos' })` times out. The role test already passes, because Task 4 added the role to `ROLES`.

- [ ] **Step 3: Write the section, add it to the page, and seed a photographer**

`src/admin/PhotosSection.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { ActionButton } from '../components/ActionButton.tsx';
import { ActionProvider } from '../components/ActionProvider.tsx';
import { useToast } from '../components/Toasts.tsx';
import { errorMessage } from '../lib/api.ts';
import { useApi } from '../lib/ApiProvider.tsx';

const photos = (n: number) => `${n} ${n === 1 ? 'photo' : 'photos'}`;

/** How many candidate photos are stored, and deleting them all (they are kept until an admin does). */
export function PhotosSection() {
  const api = useApi();
  const toast = useToast();
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCount(await api.photoCount());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ActionProvider onSettled={() => void load()}>
      <section aria-labelledby="photos-title" className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
        <h2 id="photos-title" className="font-semibold">Photos</h2>
        <p className="text-sm text-slate-600">
          {count === null ? (error ? `Couldn't count the photos: ${error}` : 'Counting photos…') : `${photos(count)} stored.`} Photos are
          kept until you delete them.
        </p>
        <ActionButton
          variant="danger"
          disabled={!count}
          confirm={count ? `Delete all ${photos(count)}? This can't be undone.` : undefined}
          action={async () => {
            const deleted = await api.deleteAllPhotos();
            toast.show(`Deleted ${photos(deleted)}.`, 'success');
          }}
        >
          Delete all photos
        </ActionButton>
      </section>
    </ActionProvider>
  );
}
```

In `src/admin/AdminPage.tsx`, add `import { PhotosSection } from './PhotosSection.tsx';` and render `<PhotosSection />` between `<SettingsSection />` and `<ProjectorLinkSection />`.

In `scripts/seed-dev.ts`:
- Add `{ username: 'photos', displayName: 'Photographer', role: 'photographer' },` to `ACCOUNTS`, after the `queue` account.
- Change the top comment to `// Local development data: seven accounts and 60 fake candidates. Safe to re-run.`

- [ ] **Step 4: Run the unit tests, the type check and the seed**

Run: `npm run test:unit && npm run typecheck && npm run seed:dev`
Expected: everything passes, and `tsc` prints nothing. `seed:dev` prints `created  photos (photographer)` (or `exists` on a re-run).

- [ ] **Step 5: Commit**

```bash
git add src/admin/PhotosSection.tsx src/admin/AdminPage.tsx scripts/seed-dev.ts tests/unit/web/photosSection.test.tsx
git commit -m "feat(web): admins delete all photos from /admin; dev seed gets a photographer"
```

---

### Task 10: Photos end to end in real browsers

**Files:**
- Create: `tests/e2e/photos.spec.ts`

**Interfaces:**
- Consumes: everything above; the dev accounts `queue`, `photos`, `panelist3` and `admin` (Task 9's seed); the dev server's `/api/photos` (Task 3).
- Produces: nothing new. This task pins spec §11's E2E scenarios.

- [ ] **Step 1: Write the test**

`tests/e2e/photos.spec.ts`:

```ts
// Candidate photos in real browsers: the photographer's list and camera, the queue manager's
// "no photo yet" question (take one on the spot, or send without), the photo on the panelist's card,
// and an admin deleting them all. Uses the dev accounts from `npm run seed:dev`.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { localEnv } from '../../scripts/lib/local-env.ts';
import { usernameToEmail } from '../../supabase/functions/_shared/accounts.ts';
import { createApi, type Api } from '../../src/lib/api.ts';

const PASSWORD = 'induction-dev';
const stamp = String(Date.now()).slice(-6);
const people = ['Photo Ready', 'Photo Later', 'Photo Never'].map((name, i) => ({ name: `${name} ${stamp}`, reg: `PH${i}${stamp}` }));
let panelId: string | undefined;

async function apiAs(username: string): Promise<Api> {
  const env = localEnv();
  const client = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email: usernameToEmail(username), password: PASSWORD });
  if (error) throw error;
  return createApi(client);
}

async function signIn(browser: Browser, username: string, path: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(path);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  return page;
}

async function joinPanel(page: Page, name: string): Promise<void> {
  const chooser = page.getByRole('heading', { name: 'Which panel are you sitting in?' });
  const select = page.getByRole('combobox', { name: 'Your panel' });
  await expect(chooser.or(select)).toBeVisible();
  if (await chooser.isVisible()) await page.getByRole('button', { name, exact: true }).click();
  else await select.selectOption({ label: name });
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

/** A 1600×1200 JPEG drawn in the page: twice the 800 px the app keeps. */
async function bigJpeg(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 1200;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#2563eb';
    context.fillRect(0, 0, 1600, 1200);
    context.fillStyle = '#f59e0b';
    context.fillRect(400, 300, 800, 600);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.95));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  return Buffer.from(bytes);
}

async function endCurrentInterview(qmApi: Api): Promise<void> {
  const panel = (await qmApi.boardSnapshot()).panels.find((p) => p.id === panelId);
  if (panel?.current) await qmApi.endInterview(panel.current.interview_id);
}

test('photos from check-in to the panel, and deleting them all', async ({ browser }) => {
  // Setup through the API: a panel of our own and three checked-in candidates.
  const qmApi = await apiAs('queue');
  panelId = await qmApi.addPanel();
  const board = await qmApi.boardSnapshot();
  const panelName = board.panels.find((p) => p.id === panelId)!.name;
  await qmApi.importCandidates(people.map((p) => ({
    submitted_at: new Date().toISOString(), reg_number: p.reg, full_name: p.name, email: '', account_email: '',
    phone: '', department: '', batch: '', preferences: ['', '', '', ''],
    answers: { general: [], dev: [], logikal: [], lnd: [], marketing: [] },
  })));
  const everyone = await qmApi.listCandidates(board.induction.id);
  const [ready, later, never] = people.map((p) => everyone.find((c) => c.reg_number === p.reg)!);
  for (const candidate of [ready, later, never]) await qmApi.checkIn(candidate.id);

  // The photographer photographs the first one; the photo is kept at 800 px.
  const photographer = await signIn(browser, 'photos', '/photos');
  const needs = photographer.getByRole('list', { name: 'Needs photo' });
  await needs.getByRole('button', { name: `#${ready.number} ${ready.full_name}` }).click();
  const capture = photographer.getByRole('dialog', { name: `Photo of #${ready.number} ${ready.full_name}` });
  await capture.getByLabel('Photo file').setInputFiles({ name: 'ready.jpg', mimeType: 'image/jpeg', buffer: await bigJpeg(photographer) });
  await expect(capture.getByRole('img', { name: `New photo of ${ready.full_name}` })).toBeVisible();
  await capture.getByRole('button', { name: 'Save' }).click();
  await expect(capture).toBeHidden();
  const thumbnail = photographer.getByRole('list', { name: 'Done' }).getByRole('img', { name: `Photo of ${ready.full_name}` });
  await expect(thumbnail).toBeVisible();
  expect(await thumbnail.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([800, 600]);
  await expect(needs.getByRole('button', { name: `#${later.number} ${later.full_name}` })).toBeVisible();

  // The queue manager sees who has no photo.
  const qm = await signIn(browser, 'queue', '/queue');
  const pool = qm.getByRole('list', { name: 'Waiting pool' });
  const row = (candidate: { full_name: string }) => pool.getByRole('listitem').filter({ hasText: candidate.full_name });
  await expect(row(later).getByRole('button', { name: `Take a photo of #${later.number}` })).toBeVisible();
  await expect(row(ready).getByRole('button', { name: `Take a photo of #${ready.number}` })).toHaveCount(0);

  // No photo yet: take it on the spot, and the send-in carries on.
  const panelCard = qm.getByRole('region', { name: panelName });
  await row(later).getByRole('button', { name: `Send in → ${panelName}` }).click();
  const question = qm.getByRole('alertdialog', { name: 'No photo yet' });
  await expect(question).toContainText(`#${later.number} ${later.full_name} has no photo yet.`);
  await question.getByRole('button', { name: 'Take photo' }).click();
  const qmCapture = qm.getByRole('dialog', { name: `Photo of #${later.number} ${later.full_name}` });
  await qmCapture.getByLabel('Photo file').setInputFiles({ name: 'later.jpg', mimeType: 'image/jpeg', buffer: await bigJpeg(qm) });
  await qmCapture.getByRole('button', { name: 'Save' }).click();
  await expect(panelCard.getByText('Now interviewing')).toBeVisible();
  await expect(panelCard).toContainText(later.full_name);
  await endCurrentInterview(qmApi);

  // With a photo: straight in, and the panelist sees the face on the card.
  const panelist = await signIn(browser, 'panelist3', '/panel');
  await joinPanel(panelist, panelName);
  await row(ready).getByRole('button', { name: `Send in → ${panelName}` }).click();
  await expect(panelCard).toContainText(ready.full_name);
  await expect(qm.getByRole('alertdialog', { name: 'No photo yet' })).toHaveCount(0);
  await expect(panelist.getByRole('heading', { name: `#${ready.number} ${ready.full_name}` })).toBeVisible();
  await expect(panelist.getByRole('img', { name: `Photo of ${ready.full_name}` }).first()).toBeVisible();
  await endCurrentInterview(qmApi);

  // Without a photo, sent anyway: the panelist sees the placeholder.
  await row(never).getByRole('button', { name: `Send in → ${panelName}` }).click();
  await qm.getByRole('alertdialog', { name: 'No photo yet' }).getByRole('button', { name: 'Send without photo' }).click();
  await expect(panelCard).toContainText(never.full_name);
  await expect(panelist.getByRole('img', { name: `No photo of ${never.full_name}` }).first()).toBeVisible();

  // An admin deletes every photo.
  const admin = await signIn(browser, 'admin', '/admin');
  const section = admin.getByRole('region', { name: 'Photos' });
  await expect(section).toContainText(/\d+ photos? stored\./);
  admin.once('dialog', (dialog) => void dialog.accept());
  await section.getByRole('button', { name: 'Delete all photos' }).click();
  await expect(admin.getByText(/^Deleted \d+ photos?\.$/)).toBeVisible();
  await expect(section).toContainText('0 photos stored.');
});

// Put the shared dev database back: end our interview, let the panelist leave, delete our panel.
test.afterAll(async () => {
  const [qmApi, panelist] = await Promise.all([apiAs('queue'), apiAs('panelist3')]);
  await endCurrentInterview(qmApi).catch(() => undefined);
  await panelist.setMyPanel(null).catch(() => undefined);
  if (panelId) await qmApi.deletePanel(panelId).catch(() => undefined);
});
```

- [ ] **Step 2: Run it**

Run (the local stack up; `npm run seed:dev` and `npm run web:env` done): `npx playwright test tests/e2e/photos.spec.ts`
Expected: `1 passed`. If Chromium is missing from `~/.cache/ms-playwright`, stop and ask before downloading a browser.

- [ ] **Step 3: Run the whole E2E suite**

Run: `npm run test:e2e`
Expected: every spec passes (`induction-day`, `panel-chat` and `photos`).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/photos.spec.ts
git commit -m "test(e2e): photographer, queue manager, panelist and admin photo flows in Chromium"
```

---

### Task 11: Docs and the full check

**Files:**
- Modify: `readme.md`
- Modify: `docs/deployment.md`

**Interfaces:**
- Consumes: everything above.
- Produces: documentation for the new role, the local photo folder and the R2 setup. The whole suite is green.

- [ ] **Step 1: Update the readme**

In `readme.md`:
- In the seed line of `## Local development`, change the comment to `# accounts admin, queue, photos, panelist1-4 (password: induction-dev) + 60 fake candidates`.
- In `## Web app`, add after the `queue` bullet:

```markdown
- `photos` (photographer): `/photos`, a phone screen listing everyone waiting; tap a name, take the
  photo, save. While developing, photos are saved in `.local-photos/` (Cloudflare R2 in production).
```

- In `## Tests`, change `Each E2E run imports a few candidates ("Eesha Test …", "Chat Test …")` to `Each E2E run imports a few candidates ("Eesha Test …", "Chat Test …", "Photo Ready …")`.

- [ ] **Step 2: Update the deployment guide**

In `docs/deployment.md`:
- In `## 3. Push the database and the edge function`, add after the paragraph about `--no-verify-jwt`:

```markdown
Redeploy `admin-users` whenever a release adds a role (candidate photos added **Photographer**):
until then the function refuses to create accounts with the new role.
```

- In `## 5. Publish the website on Cloudflare Pages`, replace item 4 with:

```markdown
4. Candidate photos are stored in Cloudflare R2:
   - **R2 → Create bucket**, name `mlsa-induction-photos`. Leave public access (`r2.dev` and custom
     domains) off: photos are only ever served through the site's `/api/photos`, which checks the login.
   - In the Pages project: **Settings → Bindings → Add → R2 bucket**, variable name `PHOTOS`, bucket
     `mlsa-induction-photos`, for **Production** (and **Preview** if you use preview builds).
   - The photo function reads the same `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as the build.
5. Deploy (or redeploy after adding the binding). Pages serves the app for every path because the build
   has no `404.html`, so links such as `/queue` or `/display?key=…` work when opened directly.
```

- At the end of `## 8. After the interviews`, add:

```markdown
Candidate photos stay in R2 until an admin presses **Delete all photos** on `/admin`. Do that once
decisions are final and nobody needs to put faces to names any more.
```

- [ ] **Step 3: Run everything**

Run:

```bash
npm run typecheck && npm run build && npm run test:unit
npm run db:test
npm run test:integration   # functions:serve running in a second terminal
npm run test:e2e
```

Expected:
- `tsc` prints nothing, and the build succeeds.
- The unit tests, `Result: PASS` from pgTAP, the integration tests and the E2E specs all pass.

- [ ] **Step 4: Commit**

```bash
git add readme.md docs/deployment.md
git commit -m "docs: photographer account, local photo folder, and the R2 bucket for deployment"
```

---

### Task 12: Rollout (production: ask the user before each step)

Each step changes a live system. Say what the step will do, wait for the user's yes, then run it. The Cloudflare account is `e44f103c…` (Pages project `mlsa-inductions`). The Supabase project ref is `ezubbhyputtlucvdjenx`.

- [ ] **Step 1: Create the bucket and bind it (Cloudflare MCP)**
  - Create the bucket: `POST /accounts/{accountId}/r2/buckets` with `{"name": "mlsa-induction-photos"}`.
  - Confirm public access is off: `GET /accounts/{accountId}/r2/buckets/mlsa-induction-photos/domains/managed` should report `enabled: false`.
  - `GET /accounts/{accountId}/pages/projects/mlsa-inductions` and note `deployment_configs.preview.env_vars`.
  - `PATCH` the project, adding `r2_buckets: { "PHOTOS": { "name": "mlsa-induction-photos" } }` to both `deployment_configs.production` and `deployment_configs.preview`.
  - If preview has no `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `NODE_VERSION`, add them to `deployment_configs.preview.env_vars` as `plain_text`, copying the production values.
  - Check with a second `GET`: both environments list `PHOTOS`.
  - Leave the existing `microsoft-club-giki` bucket alone.

- [ ] **Step 2: Apply the migration to production (Supabase MCP)**
  - `apply_migration` with name `candidate_photos` and the contents of `supabase/migrations/20260927000300_candidate_photos.sql`.
  - Fix the recorded version as before: `update supabase_migrations.schema_migrations set version = '20260927000300' where name = 'candidate_photos';`.
  - Check with `select version, name from supabase_migrations.schema_migrations order by version desc limit 2;`.
  - Then `select enum_range(null::public.app_role);` should include `photographer`.
  - The live site keeps working: it ignores the new `has_photo` key and the new functions.

- [ ] **Step 3: Redeploy `admin-users` (Supabase MCP)**
  - `deploy_edge_function` with `admin-users/index.ts`, `admin-users/validate.ts`, `admin-users/deno.json` and `_shared/accounts.ts` (entrypoint `admin-users/index.ts`), with `verify_jwt: false`.
  - Check with `get_edge_function`: the new version is active and `verify_jwt` is false.

- [ ] **Step 4: Preview build and a real phone test**
  - Push the branch (`git push -u origin candidate-photos`, after the user's yes).
  - Turn on preview builds for this branch only: in the dashboard, **Settings → Builds → Branch control → Preview branches: Custom → include `candidate-photos`**. Or via the API: `PATCH` the project's `source.config` with `preview_deployment_setting: "custom"` and `preview_branch_includes: ["candidate-photos"]`, keeping the rest of `source.config` as returned by `GET`.
  - Wait for the preview deployment, then give the user its URL.
  - The preview talks to the live database. Before the event, with the user:
    - an admin creates a photographer account;
    - import one test candidate (reg `PHOTOTEST1`) and check them in;
    - photograph them on an iPhone and an Android if available (**Take photo** opens the back camera, **Save**, Done shows the thumbnail);
    - on a laptop, the queue manager's **Take photo** shows the webcam;
    - an admin sees the photo on the candidate's results page.
  - Clean up afterwards, with the user's yes:
    - if no real photos exist yet, press **Delete all photos** on `/admin`;
    - `delete from public.candidates where reg_number = 'PHOTOTEST1';`;
    - disable the test photographer account if it isn't a real one.

- [ ] **Step 5: Merge and deploy**
  - Open a PR from `candidate-photos` to `main` (after the user's yes), with a summary of the feature and the rollout steps already done.
  - When the user merges it, Cloudflare builds `main`. Check that `https://mlsa-inductions.pages.dev/photos` loads the sign-in page. Signed in as the admin, `/photos` shows the list, and `curl -s -o /dev/null -w '%{http_code}' https://mlsa-inductions.pages.dev/api/photos/00000000-0000-0000-0000-000000000000` prints `401`.
  - Set preview branches back to none.

- [ ] **Step 6: Accounts and notes**
  - The admin creates the real photographer accounts in **Admin → Accounts**.
  - Update the memory note `production-deployment.md` with what was done: bucket created, binding, migration version, `admin-users` version, and preview settings restored.
