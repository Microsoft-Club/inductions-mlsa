# Architecture

_Written 2026-10-16 at commit `f49b444`. Checked against the code, not just the design specs. Where the
code and `docs/superpowers/specs/` disagree, this file follows the code._

## 1. What the system is

A realtime web app that runs the Microsoft Club GIKI induction day (recruitment interviews). It replaces
Google Forms + Sheets + WhatsApp + someone calling out the queue. Everyone on the day looks at the same
live state:

- the **queue manager** checks candidates in, lines them up and sends them into panels;
- **panelists** read the candidate's application, chat with their panel about them, and submit an evaluation;
- a **photographer** photographs waiting candidates so faces can be put to names;
- the **projector** in the waiting room shows who is being interviewed, who is next, and a timer;
- **admins** manage accounts and panels, review every evaluation, set decisions, export CSVs and publish results;
- the **public** `/selected` page lists the selected candidates once results are published.

Candidates never sign in. Their data comes from the Google Form, by CSV import or by the live form sync.

Hosting is free tier: **Supabase** (Postgres, Auth, Realtime, two Edge Functions) and **Cloudflare Pages**
(the static site, one Pages Function, and an R2 bucket for photos).

## 2. The big picture

```
   Staff browsers (queue desk, panelist phones/laptops, photographer phone, admin)    Projector (no login)
          │                    │                         ▲                                │        ▲
          │ RPC + SELECT       │ PUT/GET /api/photos      │ WebSocket: "board changed"     │ RPC    │ public channel
          │ (supabase-js)      │ (Bearer user token)      │ "interview:<id> changed"       │        │ display:<key>
          ▼                    ▼                         │                                ▼        │
 ┌──────────────────────┐  ┌───────────────────────────┐  ┌────────────────────────────────────────────────┐
 │ Cloudflare Pages     │  │ Pages Function            │  │ Supabase                                       │
 │ static React app     │  │ functions/api/photos      │  │                                                │
 │ (dist/, SPA routing) │  │  → server/photos/handler  │──┼─▶ Postgres: tables (read-only to clients, RLS) │
 └──────────────────────┘  │  asks Postgres "allowed?" │  │   + one SECURITY DEFINER function per action   │
                           │  with the user's token    │  │   + realtime.send() at the end of each action  │
                           └────────────┬──────────────┘  │ Auth: username → internal email, no signup    │
                                        ▼                 │ Realtime Broadcast: board / interview / display │
                                 R2 bucket (photos)       │ Edge Functions: admin-users, form-sync          │
                                                          └───────────────────────▲────────────────────────┘
                                                                                  │ POST + shared secret
                                                       Google Form → responses sheet → Apps Script
```

Three ideas carry most of the design:

1. **All business logic lives in Postgres.** Clients can only `SELECT` (through row-level security). Every
   change (check in, send in, end, evaluate, publish…) is one `SECURITY DEFINER` SQL function called over
   RPC. Each checks the caller's role, validates state, does its work in one transaction and broadcasts.
2. **A broadcast only means "something changed".** Screens never apply realtime payloads. On every event
   (and on every reconnect, on the page becoming visible, and every 30 s) they reload a snapshot from
   the database. That makes missed or duplicated events harmless.
3. **The browser is thin and testable.** Screens talk to one `Api` object (`src/lib/api.ts`) and one
   `AuthBackend`. Both are injected through React context, so component tests pass fakes. Decisions a
   screen makes live in pure `*View.ts` modules next to its components.

## 3. Tech stack

| Area | What | Where |
| --- | --- | --- |
| Language | TypeScript everywhere; SQL (PL/pgSQL) for the backend logic | `tsconfig.json` (strict) |
| Frontend | React 19, React Router 8, Tailwind CSS 4, Vite 8 | `src/`, `vite.config.ts` |
| Backend | Supabase: Postgres 17, Auth, Realtime Broadcast, Edge Functions (Deno) | `supabase/` |
| Photos | Cloudflare Pages Function + R2 bucket `mlsa-induction-photos` | `functions/`, `server/photos/` |
| CSV | PapaParse (import in the browser, export in the browser) | `src/csv/`, `src/results/` |
| Tests | pgTAP, Vitest (+ Testing Library, jsdom), Playwright | `supabase/tests/`, `tests/` |
| Runtime | Node 24+ (scripts run `.ts` directly with `node`), Docker for the local Supabase stack | `package.json` |

There is no global state library and no server of our own besides the photo function.

## 4. Repository layout

| Path | What it holds |
| --- | --- |
| `src/main.tsx` | Browser entry: builds the real `Api` and `AuthBackend` from one Supabase client and mounts the router. |
| `src/app/` | Routes, providers, login, the signed-in layout (`StaffLayout`), role guard (`RequireRole`), error screen. |
| `src/auth/` | `AuthProvider` (signed-in state, profile, disabled-account handling) and the Supabase auth backend. |
| `src/lib/` | The data layer: `api.ts` (every call), `types.ts` (response shapes), `realtime.ts`, `useLiveSnapshot.ts`, clock sync. |
| `src/components/` | Shared UI: `ActionButton`/`ActionProvider` (run an action, toast on failure, reload), toasts, timer, connection banner. |
| `src/queue/` | `/queue`: the queue manager's board (panels, lanes, pool, search, candidate lists, CSV import, form warnings, photo prompts). |
| `src/panel/` | `/panel`: the panelist's screen (candidate card, application tabs, chat, evaluation form, recent/pending interviews). |
| `src/photos/` | `/photos` (photographer), the capture view, photo shrinking, and the cached `CandidatePhoto` component. |
| `src/display/` | `/display?key=…`: the projector. |
| `src/admin/` | `/admin`: accounts, panels, settings + projector link, delete all photos. |
| `src/results/` | `/results` and `/results/:candidateId`: results table, score, decisions, CSV exports, publishing, full candidate record. |
| `src/public/` | `/selected`: the public list of selected candidates. |
| `src/csv/` | `parseFormExport.ts`: reads a Google Forms CSV export in the browser. |
| `supabase/migrations/` | The whole backend: schema, RLS, every action and read function, realtime policies. Applied in filename order. |
| `supabase/functions/admin-users/` | Edge Function: create / reset password / disable / change role / delete accounts (service role). |
| `supabase/functions/form-sync/` | Edge Function: receives Google Form responses from the Apps Script. |
| `supabase/functions/_shared/` | Code shared by Deno, Node and the browser: account rules, the form layout, form-row mapping. |
| `supabase/tests/` | pgTAP tests for every action, RLS rule and privilege. |
| `server/photos/` | The photo API logic (handler, permission gate, bucket interface, local folder bucket, dev server adapter). |
| `functions/api/photos/[[path]].ts` | The Cloudflare Pages wrapper around `server/photos/handler.ts`. |
| `scripts/` | `create-admin`, `seed-dev`, `write-web-env`, and `google-form-sync.gs` (the Apps Script). |
| `tests/` | `unit/`, `integration/`, `e2e/`, `stress/`. See [§13](#13-testing). |
| `fixtures/` | A fake form export (the only CSV allowed in git). |
| `docs/` | This file, deployment, form sync, and the original specs and plans under `superpowers/`. |

## 5. Roles and access

Roles are a Postgres enum (`app_role`) on `profiles`. RLS policies and action functions name the roles they
allow, so a role starts with no access until it is listed.

| Who | Screen | Can |
| --- | --- | --- |
| **Admin** | every screen | Everything below, plus accounts, add/delete panels, settings, projector link, decisions, publishing, remove someone from a panel, delete all photos. |
| **Queue manager** | `/queue` | Import CSV, dismiss form warnings, check in, reorder/skip/line up, send in, undo send-in, end and reopen interviews, take photos. **Cannot** read chat or evaluations, or add/delete panels. |
| **Panelist** | `/panel` | Read candidates, the board and interviews; pick the panel they sit in; chat; write and read **their own** evaluations; End and "Ready for next" **only on their own panel**; view photos. |
| **Photographer** | `/photos` | Read their own profile, hear the "board changed" signal, list waiting candidates (`photo_queue`), photograph waiting candidates. Nothing else. |
| **Projector** | `/display?key=…` | No login. `display_snapshot(key)` returns numbers, names, panels, start times and the waiting list. A wrong key returns nothing. |
| **Public** | `/selected` | `published_results()`: names and reg numbers of selected candidates, only once published. |

How a role is enforced, layer by layer:

- **Database:** `has_role()` in every RLS read policy; `require_role()` as the first line of every action
  function (raises `Not allowed`, SQLSTATE `42501`). This is the only layer that is trusted.
- **Edge function `admin-users`:** checks the caller is an active admin before using the service-role key.
- **Photo API:** never checks tokens itself. It calls `authorize_photo_*` RPCs with the user's own token, so
  Postgres decides.
- **Browser:** `RequireRole` on routes and the nav list in `StaffLayout` only hide what a role can't use.

Accounts: there is no signup. Usernames map to `<username>@users.induction.local`
(`supabase/functions/_shared/accounts.ts`). The first admin comes from `npm run create-admin`; admins make
the rest in the app. Disabling an account bans the auth user and sets `profiles.is_active = false`; RLS
checks `is_active`, and access tokens last 10 minutes (`jwt_expiry = 600`). When any call answers
`Not allowed`, the browser re-checks the profile and signs out a disabled account (`src/lib/notAllowed.ts`).
The `adminmlsa` account is protected from other admins (`PROTECTED_USERNAMES`).

## 6. Data model

Everything except `profiles` belongs to an **induction**. Exactly one induction is active at a time
(partial unique index); a new one is made in SQL with `select public.create_induction('Fall 2027');`.

| Table | Holds |
| --- | --- |
| `inductions` | Name, `is_active`, secret `display_key` (projector link; not readable by clients), target interview minutes, `results_published`. |
| `profiles` | One per auth user: username, display name, role, `is_active`, `current_panel_id` (the panel they are sitting in). |
| `panels` | "Panel N", sort order, soft delete (`deleted_at`) so past interviews keep their panel. |
| `candidates` | From the form: `number` (assigned once, never changes), normalised `reg_number`, contact details, `preferences[4]`, `answers` (jsonb, by section). Day state: `status`, `checked_in_at`, `decision`, `photo_taken_at/by`. |
| `queue_entries` | Exists only while a candidate is `waiting`. `panel_id` null = the waiting pool, otherwise that panel's lane. `position` is 1..n per lane. |
| `interviews` | Candidate × panel, `in_progress` / `ended` / `cancelled`, server-time `started_at`/`ended_at`, `ready_at` (panel ready for the next person). At most one `in_progress` per panel and per candidate (partial unique indexes). |
| `messages` | Panel chat, per interview. The id can come from the browser so a resend never posts twice. |
| `evaluation_criteria` | Seeded per induction: `general` (1–5) and `team_fit` (1–5 or N/A), including Brainees. Changed in SQL. |
| `evaluations` | One per panelist per interview: `scores` jsonb, required `recommendation`, comments. |
| `form_warnings` | Things the Google Form sync wants a person to check, until dismissed. |

`answers` keeps the form's sections as ordered lists, so question order survives and the same question can
appear in two sections:

```json
{ "general": [{ "q": "What motivated you…?", "a": "…" }], "dev": [], "logikal": [], "lnd": [], "marketing": [], "brainees": [] }
```

### Candidate lifecycle

```
             check in                    send in                         end
 registered ─────────▶ waiting ─────────────────────────▶ interviewing ─────────▶ interviewed
            ◀─────────          ◀─────────────────────────              ◀─────────
           undo check-in        undo send-in (back to the top of          reopen (the panel's latest
                                that panel's lane; refused once           interview, while the panel
                                anyone has evaluated)                     is free; timer continues)
```

- Inside `waiting`, a candidate moves between the pool and panel lanes (`move_candidate`, `skip_candidate`).
- **Send in to a panel nobody is sitting in** doesn't start an interview: the person is lined up at the
  front of that panel's lane instead, and `send_in` returns `null`.
- After **End**, the panel is "wrapping up" until one of its panelists presses **Ready for next**
  (`mark_panel_ready`, unlocked 15 s after End). The queue manager can still send someone in; the board
  asks first.
- **Publishing results** locks evaluations (`submit_evaluation` refuses).

## 7. Backend: Postgres functions

Every action follows the same shape (see `supabase/migrations/20260925000300_queue_actions.sql`):

```sql
v_uid := public.require_role('admin', 'queue_manager');   -- 1. who may call it
v_ind := public.require_active_induction();
perform public.lock_queue(v_ind);                          -- 2. serialise with every other queue action
select … for update; if <wrong state> then raise exception 'Candidate #% is not waiting', …; end if;
-- 3. all changes, in this one transaction
perform public.broadcast_board();                          -- 4. tell every screen
```

- `lock_queue` takes a transaction-scoped advisory lock per induction, so two desks or a double click
  can't interleave. The partial unique indexes on `interviews` are the backstop.
- Error messages are written for people ("Panel 2 is busy"). The browser shows them as toasts unchanged.
- A broadcast failure is downgraded to a warning: it never fails the action.
- Functions use `security definer` with `search_path = ''`. Helpers have execute revoked from
  `anon`/`authenticated`; only the intended entry points are granted.

| Group | Functions |
| --- | --- |
| Reads | `board_snapshot` (staff), `display_snapshot(key)` (anyone), `photo_queue`, `interview_messages`, `evaluation_count`, `my_pending_interviews`, `results_table`, `candidate_record`, `evaluations_export`, `published_results`, `get_display_key`, `photo_count`, `server_now` |
| Queue | `check_in`, `undo_check_in`, `move_candidate`, `skip_candidate`, `send_in`, `undo_send_in` |
| Interviews | `end_interview`, `reopen_interview`, `mark_panel_ready` |
| Panels | `add_panel` (lowest free number), `delete_panel` (lane goes back to the pool), `set_my_panel`, `remove_from_panel` |
| Chat / evaluations | `post_message`, `submit_evaluation` |
| Candidate intake | `import_candidates` (CSV), `sync_form_response` and `note_form_problem` (form sync, service role only), `dismiss_form_warning`; both import paths share `import_candidates_core` |
| Admin | `set_decision`, `set_results_published`, `regenerate_display_key`, `update_settings` |
| Photos | `authorize_photo_upload`, `record_photo`, `authorize_photo_view`, `authorize_photo_purge`, `clear_photos` |

### Finding the current version of a function

Migrations are append-only. A later fix redefines a function with `create or replace` in a new file, so the
**last** migration that defines a function holds its current body. The ones redefined so far:

| Function | Current definition |
| --- | --- |
| `board_snapshot`, `reopen_interview` | `20261002000100_panel_ready.sql` |
| `add_panel`, `delete_panel` | `20261007000200_admin_only_panels.sql` |
| `undo_send_in`, `submit_evaluation` | `20261007000300_undo_send_in_guard.sql` |
| `import_candidates` | `20260929000300_google_form_sync.sql` |
| `send_in` | `20260929000200_send_in_empty_panel_lines_up.sql` |
| `end_interview` | `20260929000100_end_interview_own_panel.sql` |
| `create_induction` | `20261001000100_brainees_team_fit.sql` |
| `lane_json` | `20260927000300_candidate_photos.sql` |
| `results_table` | `20260927000200_results_panels.sql` |
| `evaluations_export` | `20260927000100_export_updated_at.sql` |
| `set_results_published` | `20260926000100_publish_broadcast.sql` |

Everything else is defined once. To check, run
`grep -n "function public.<name>" supabase/migrations/*.sql` and read the last match.

## 8. Realtime

Supabase Realtime **Broadcast**, sent from SQL with `realtime.send(...)`.

| Topic | Access | Sent by | Listened to by |
| --- | --- | --- | --- |
| `board` | Private. A `realtime.messages` policy admits active admins, queue managers, panelists and photographers. | `broadcast_board()` at the end of every queue, interview, panel, import, photo, form-warning and publish action | `/queue`, `/panel`, `/photos`, admin panels section |
| `interview:<id>` | Private. Admins and panelists. | `post_message`, `submit_evaluation` | The panelist's chat and evaluation form (one shared subscription, `useInterviewLive`) |
| `display:<display_key>` | Public. The secret key in the topic is the protection. | `broadcast_board()` (sends the snapshot) | `/display` |

The client side is two pieces:

- **`broadcastSubscriber`** (`src/lib/realtime.ts`) joins one topic. Private topics call
  `realtime.setAuth()` first. If the server closes the channel it rejoins with backoff (1 s, 2 s, 5 s, then
  every 10 s). The Supabase client heartbeats every 10 s (`src/lib/supabase.ts`), so a dead connection is
  noticed in 10–20 s.
- **`useLiveSnapshot(load, subscribe, pollMs)`** (`src/lib/useLiveSnapshot.ts`) is the loop every live
  screen uses. It reloads on: every event, every (re)subscribe, the browser going back online, the page
  becoming visible again, and every 30 s (`STAFF_RESYNC_MS`). Loads never overlap (events during a load
  cause exactly one more), and answers for an old subscription are dropped. It reports
  `connecting` / `live` / `reconnecting` for the "Reconnecting…" banner.

The projector also ignores the snapshot in its broadcast and re-reads `display_snapshot`: anyone with the
link could send messages on a public channel (`src/display/DisplayPage.tsx`).

**Timers** never use the network per tick. `ClockProvider` measures the offset to the server with
`server_now()` (offset = server time + RTT/2 − client time) on load and every 5 minutes. Each timer computes
`now + offset − started_at` once a second (`src/lib/clock.ts`). It turns amber past the target length.

## 9. Frontend

### Boot and providers

`main.tsx` → `AppProviders` (`ApiProvider` → `AuthProvider` → `ToastProvider` → `ClockProvider`) →
`RouterProvider(routes)`. Tests render the same `routes` inside `AppProviders` with a fake `Api` and
`AuthBackend` (`tests/unit/web/helpers.tsx`).

### Routes

| Path | Guard | Page |
| --- | --- | --- |
| `/login` | none | `app/LoginPage.tsx`. After sign-in, goes to `?next=` (same-site paths only) or the role's home. |
| `/display?key=…[&panel=<id>]` | none (secret key) | `display/DisplayPage.tsx` |
| `/selected` | none | `public/SelectedPage.tsx` |
| `/` | signed in | `StaffLayout` (header, nav, sign out) → redirects to the role's home (`homePath`) |
| `/queue` | queue_manager, admin | `queue/QueuePage.tsx` |
| `/panel` | panelist, admin | `panel/PanelPage.tsx` |
| `/photos` | photographer, admin | `photos/PhotosPage.tsx` |
| `/admin` | admin | `admin/AdminPage.tsx` |
| `/results`, `/results/:candidateId` | admin | `results/ResultsPage.tsx`, `results/CandidateRecordPage.tsx` |

Cloudflare Pages serves `index.html` for any path (the build has no `404.html`), so deep links work.

### Patterns every screen follows

- **Reading:** `useLiveSnapshot(api.boardSnapshot, api.subscribeBoard(), STAFF_RESYNC_MS)`, or the photo
  queue or interview equivalent. `load` and `subscribe` must be stable (`useCallback`/`useMemo`).
- **Writing:** wrap the screen in `<ActionProvider onSettled={reload}>` and use `<ActionButton action={…}>`.
  The button blocks double clicks with a ref, can ask for confirmation, shows the server's error as a toast,
  and the screen reloads its snapshot afterwards whether the action worked or not.
- **Logic out of components:** `queueView.ts`, `panelView.ts`, `displayView.ts`, `resultsView.ts`,
  `photoQueueView.ts`, `evaluation.ts`, `applicationView.ts` are pure functions with their own unit tests.
- **Errors:** `api.ts` turns every failure into a short message: network down, timeout (an action that
  timed out "may still have gone through"), session renewing (401), `Not allowed` (403/`42501`), or the
  database's own message. Calls time out after 15 s (imports and photo purge after 60 s).

### What lives only on the device

Kept in `localStorage`, per user and per interview, so panelists sharing a laptop never see each other's:

- evaluation drafts (`panel/evaluation.ts`);
- chat drafts and unsent messages (`panel/chatDrafts.ts`). Unsent messages are resent on later board
  reloads, even after the next candidate came in (`useStrandedMessages`);
- the interviews this panelist sat in (`panel/satIn.ts`). The server records an interview's panel but not
  who sat in it, so this is how a panelist who switched panels still sees evaluations they owe.

Photos are cached in memory only (object URLs, per candidate and photo version) and cleared on sign-out.
The Supabase session itself persists in `localStorage`.

### Results score

`/results` ranks candidates by a score computed in the browser (`results/resultsView.ts`): points per vote
(Strong Yes 4, Yes 3, Maybe 1, No 0), averaged with one extra imaginary vote at the induction-wide average.
One enthusiastic panelist therefore can't outrank a unanimous panel. Filters and sort live in the URL, so
Back and reload keep them.

## 10. Edge functions (Deno, Supabase)

**`admin-users`** (`supabase/functions/admin-users/`): the only place the service-role key is used for
accounts. It verifies the caller's JWT, checks they are an active admin, validates the command
(`validate.ts`, shared with the browser as a type), then runs `create`, `reset_password`, `set_active`
(ban/unban + `is_active`), `set_role` (also clears their panel), or `delete`. Delete is refused for accounts
with evaluations or chat messages; those are disabled instead. Nobody can disable, delete or re-role
themselves.

**`form-sync`** (`supabase/functions/form-sync/`): deployed with JWT verification off. It checks an
`x-form-sync-secret` header against `FORM_SYNC_SECRET` in constant time. `handler.ts` holds the logic
without Deno APIs, so Vitest can test it. Flow:

```
Apps Script (scripts/google-form-sync.gs, "On form submit")
  POST { header: [...sheet header row], values: [...this response] }
    → matchColumns(header, FORM_LAYOUT)   questions found by title, any column order
        mismatch / wrong cell count → note_form_problem(reason) → 422 (warning on the board)
        ok → mapRow → sync_form_response(row)  (same rules as the CSV import, flags → form_warnings)
              → broadcast_board → /queue shows the new candidate and any warning
```

## 11. Candidate intake: one form layout, two paths

`supabase/functions/_shared/formLayout.ts` describes the Google Form: each column's header and where it goes
(a candidate field, an answer section, or a preference rank). `formRows.ts` turns one response into an
`ImportRow`. Both the browser CSV import (`src/csv/parseFormExport.ts` → `import_candidates`) and the
form-sync function use them, so next year's form is a change to `formLayout.ts` only.

Import rules (in SQL, `import_candidates_core`, all-or-nothing):

- candidates are matched on the normalised reg number (trimmed, spaces removed, uppercased);
- within one file, the **latest** response supplies the data and the **earliest** time sets the numbering;
- an existing candidate gets new details but keeps number, status, queue place and decision;
- new candidates are numbered in submission order after the current highest number;
- empty reg numbers, duplicate submissions and "new reg number but known email" (possible typo) are flagged.
  The CSV import shows flags in its dialog; the form sync stores them as board warnings.

## 12. Photos

```
Browser: CaptureView → shrinkPhoto (800 px long side, JPEG ~100 KB, EXIF dropped)
  PUT /api/photos/<candidateId>  Authorization: Bearer <user's Supabase access token>
    → server/photos/handler.ts
        1. size ≤ 1 MB, UUID id, JPEG magic bytes
        2. rpc authorize_photo_upload (as the user)  → file key "<induction_id>/<candidate_id>.jpg"
        3. R2 put                                     (file first…)
        4. rpc record_photo → photo_taken_at, broadcast_board   (…record second)
  GET /api/photos/<id>?v=<photo_taken_at>  → authorize_photo_view → R2 get → JPEG, Cache-Control: private, no-store
  DELETE /api/photos                        → authorize_photo_purge → delete every R2 object → clear_photos
```

- The same handler runs in three places: Cloudflare (`functions/api/photos/[[path]].ts` with the R2
  binding `PHOTOS`), `npm run dev` (a Vite plugin in `vite.config.ts` with `folderBucket('.local-photos')`),
  and the tests (fake bucket and fake `fetch`).
- `no-store` stops a shared laptop's browser cache showing one user's photo to the next. The app keeps its
  own in-memory cache instead (`src/photos/usePhoto.ts`).
- At Send in, the queue board asks "no photo yet: take one, send anyway, or cancel" (`src/queue/PhotoFlow.tsx`).

## 13. Testing

| Layer | Command | Covers | Needs |
| --- | --- | --- | --- |
| Database | `npm run db:test` | pgTAP: every action's transitions and conflicts, RLS, privileges, realtime policies (`supabase/tests/*.test.sql`) | `db:start` |
| Unit | `npm run test:unit` | Pure logic, components in jsdom with a fake `Api`, the photo handler, the form-sync handler, the Apps Script against fake Google services | nothing |
| Integration | `npm run test:integration` | The real `Api` against the local stack; `types.ts` shapes against the real functions; edge functions; realtime | `db:start`, `functions:serve` |
| End-to-end | `npm run test:e2e` | Playwright through a whole induction day, panel chat, moving panels, photos | `db:start`, `seed:dev`, `functions:serve`, `web:env` |
| Stress | `npm run stress:races` / `stress:offline` / `stress:day` | Simultaneous conflicting actions; connection drops in real Chromium; a simulated full day | local stack only (see readme) |

The readme has the full local setup. Never run the database tests or a reset against production
(`docs/deployment.md`).

## 14. Build and deploy

- `npm run build` → `dist/`. Cloudflare Pages builds `main` on every push, with `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY` and the `PHOTOS` R2 binding.
- Backend changes ship by hand: `npx supabase db push` (migrations) and
  `npx supabase functions deploy admin-users` / `form-sync --no-verify-jwt`.
- `.github/workflows/record-deployment.yml` only records Cloudflare's publish as a GitHub deployment. It
  builds, tests and deploys nothing.

Full steps, dashboard settings and the induction-day checklist: [`deployment.md`](deployment.md).

## 15. Conventions

- **New behaviour on the backend = a new migration.** Never edit an applied one; redefine with
  `create or replace` and keep the same signature where possible, so grants stay.
- **New action:** `require_role` → `require_active_induction` → `lock_queue` (if it touches queue or
  interviews) → validate with a human-readable `raise exception` → change → `broadcast_board()`. Revoke
  execute from `public, anon` and grant only what the role needs. Add a pgTAP test.
- **New read for the browser:** add it to `Api` in `src/lib/api.ts`, its shape to `src/lib/types.ts`, and
  a shape check in `tests/integration/web-api.test.ts`.
- **Screens:** load with `useLiveSnapshot`, act with `ActionButton` inside `ActionProvider`, and put
  decisions in a pure `*View.ts` with unit tests.
- **Shared code** in `supabase/functions/_shared/` must run unchanged in Deno, Node and Vite (no runtime
  imports beyond each other).
- Imports use explicit `.ts`/`.tsx` extensions. Comments explain *why*, in plain sentences, and user-facing
  text is short and specific.
- Personal data: `*.csv` is gitignored except `fixtures/`; candidate photos never go in git (`.local-photos/`).

## 16. Risks and rough edges

- **No automated test gate.** No CI runs the tests, and Cloudflare publishes `main` on every push. Running
  the suites before merging is a manual step.
- **Backend deploys are manual and separate.** A merge can ship frontend code that expects a migration or
  edge-function change not yet pushed to Supabase. `deployment.md` lists the redeploys a release needs.
- **`types.ts` is maintained by hand.** It is checked against the real functions only by the integration
  tests, which need the local stack.
- **`npm run typecheck` doesn't cover the Deno entry points** (`supabase/functions/*/index.ts`) or
  `form-sync/handler.ts`. They are only exercised by tests.
- **Current SQL is spread across migrations.** Use the table in [§7](#finding-the-current-version-of-a-function).
- **No UI for:** creating or switching inductions, editing evaluation criteria, or deleting a candidate.
  All are SQL-only.
- **Some state is per device.** Which interviews a panelist sat in, and their unsent chat, are in that
  browser's `localStorage`. On a different device a panelist only sees interviews of their current panel.
- **The results score is browser-only.** It isn't in either CSV export.
- **Free-tier operations.** The Supabase project pauses after 7 days idle. Realtime's database pool must be
  raised to 10, or a burst of reconnecting screens can sit on "Reconnecting…" (`deployment.md` §2).
- **The projector link is a bearer secret.** Anyone with it sees names and the queue. Regenerate it from
  `/admin` if it leaks.

## 17. Where the code moved past the original spec

`docs/superpowers/specs/2026-09-25-induction-system-design.md` is the original design, and most of it still
holds. Since then:

- **Photographer role and photos** (own spec: `2026-09-27-candidate-photos-design.md`).
- **Google Form sync** and board warnings (`docs/google-form-sync.md`).
- **"Wrapping up" / Ready for next** after End (`ready_at` on interviews).
- **Brainees**, a sixth answer section and team-fit criterion.
- **Admin-only panels**, and new panels reuse the lowest free number.
- **Undo send-in is refused once anyone has evaluated** (End instead).
- **Every screen re-reads on events.** The spec had the projector render the broadcast payload and chat
  apply message rows. Now every topic is just a "reload" signal, and staff screens also poll every 30 s.
- **Results** gained the panels column, a vote-based score, and filters kept in the URL.

## 18. Where to start reading

| To understand… | Read |
| --- | --- |
| How a screen gets live data | `src/lib/useLiveSnapshot.ts`, `src/lib/realtime.ts`, then `src/queue/QueuePage.tsx` |
| Every call the browser makes | `src/lib/api.ts` |
| The queue and interview rules | `supabase/migrations/20260925000300_queue_actions.sql`, then the current `send_in` / `undo_send_in` / `end_interview` |
| What the board contains | `board_snapshot` in `20261002000100_panel_ready.sql`, `BoardSnapshot` in `src/lib/types.ts` |
| Who can see what | `20260925000100_core_schema.sql` (RLS), `supabase/tests/090_security.test.sql` |
| The panelist experience | `src/panel/PanelPage.tsx`, `src/panel/panelView.ts` |
| Photos end to end | `server/photos/handler.ts`, `src/photos/CaptureView.tsx` |
| The form | `supabase/functions/_shared/formLayout.ts`, `formRows.ts` |
| Running it locally | `readme.md` |
| Deploying | `docs/deployment.md` |
