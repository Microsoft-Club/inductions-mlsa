# Microsoft Club GIKI Induction System: Design Spec

**Date:** 2026-09-25
**Status:** Approved in conversation, pending written-spec review
**Source:** `mvp-plan.md` (requirements conversation) plus the refinements agreed after it

---

## 1. Goal

Replace the induction-day mix of Google Forms + Google Sheets + WhatsApp + verbal queue calls with one realtime web app.
The queue manager, the panelists, the projector and the admins all see the same live state.

**Success looks like:**
- The queue manager checks candidates in, lines them up and sends them into free panels without leaving one screen.
- Panelists see the candidate's full application, chat about that candidate, and submit their own evaluation in one place.
- The projector shows who is being interviewed and who is next, with a timer, updating within a fraction of a second.
- After inductions, admins review every evaluation, decide who is selected, export everything as CSV, and publish the selected list on the website.
- Hosting cost is $0 on free tiers.

## 2. Context and constraints

- About 20 panelists (junior and senior members), 1 queue manager, 1+ admins.
- 1 waiting room plus 2 interview rooms. Panel 1 and Panel 2 are interchangeable. Extra panels can be added on the day.
- Candidates register through a Google Form. Its responses are exported as CSV. Re-exports are append-only: rows are never deleted.
- The venue has reliable internet. The app is cloud-hosted, developed locally first, and deployed on the cheapest reliable option.
- **Candidates do not use the app.** They have no login and no way to see their form, status, chats or evaluations. They only see the projector in the room and, after publishing, the public list of selected candidates.

## 3. Architecture

```
 QM laptop · panelist phones/laptops · projector · admin
        │ HTTPS (loading data, actions)      ▲ WebSocket (live pushes)
        ▼                                     │
 Cloudflare Pages (static React app)    Supabase Realtime
        │                                     ▲
        ▼                                     │ action functions broadcast after each change
 Supabase Postgres: tables + one database function per action + row-level security
```

- **Frontend:** React + TypeScript + Vite, React Router, Tailwind CSS, `@supabase/supabase-js`, PapaParse (CSV).
  - There is no global state library. Each screen loads a snapshot and reloads it when a realtime event arrives.
- **Backend:** Supabase.
  - Postgres holds the data.
  - Auth handles logins.
  - Realtime Broadcast pushes live updates.
  - One Edge Function manages accounts.
  - All business logic lives in Postgres functions called over RPC.
- **Local development:** Supabase CLI (Docker) plus the Vite dev server. The same code and migrations are used in production.
- **Production:**
  - Cloudflare Pages hosts the static build, with an SPA fallback.
  - Supabase Cloud hosts the backend, in the **Mumbai** region (closest to Pakistan).
  - Free-tier limits are re-checked before deploying.
- **Operational note:** free Supabase projects pause after 7 days of inactivity. Un-pausing is part of the induction-day checklist (section 13).

## 4. Roles and access

| Who | Logs in? | Can see and do |
|---|---|---|
| **Candidates** | No | Nothing in the app. They see only the projector and, once published, the public selected list. |
| **Panelist** | Yes | Read candidates (including answers and contact details), interviews and chats of **any** panel. Post chat messages. Write and read **only their own** evaluations. End interviews of the panel they are sitting in. Choose their current panel. |
| **Queue manager (QM)** | Yes | Import the CSV. Check in candidates. All queue actions. Send in. End, undo and reopen interviews. **No** adding or deleting panels (admins only). **No** access to chats or evaluations. |
| **Admin** | Yes | Everything above, plus accounts, deleting any panel, settings, results, decisions and publishing. |
| **Projector** | No (secret link) | Only the number, name, panel, interview start time, and the waiting list (numbers and names). |
| **Public results page** | No | Names and reg numbers of selected candidates, and only after results are published. |

## 5. Data model

Every table except `profiles` belongs to an `induction`. There is one active induction at a time. It is created by migration/seed for Fall 2026; a new induction next year is created by a SQL script (no UI in the MVP).

### Tables

**`inductions`**
- `id`, `name` ("Fall 2026"), `is_active`
- `display_key`: random secret of 32+ characters, used in the projector URL and channel
- `target_interview_minutes` (default 15)
- `results_published` (bool, default false)
- `created_at`

**`profiles`**: one per auth user
- `id` (= `auth.users.id`), `username` (unique; lowercase letters, digits and `_`; 3–32 characters), `display_name`
- `role` enum: `admin` | `queue_manager` | `panelist`
- `is_active`, `current_panel_id` (nullable), `created_at`

**`panels`**
- `id`, `induction_id`, `name` ("Panel 1"), `is_default` (true for Panel 1 and Panel 2), `sort_order`
- `deleted_at` (soft delete), `created_by`, `created_at`

**`candidates`**
- `id`, `induction_id`
- `number` int: unique per induction, assigned by the app and never changed
- `reg_number` text: unique per induction, normalized (trimmed, internal spaces removed, uppercased)
- `full_name`, `email` (typed email), `account_email` (the Google account email the form collected), `phone`, `department`, `batch`
- `submitted_at` (form timestamp of the earliest submission for this reg number)
- `preferences` text[4]: team preferences 1–4
- `answers` jsonb (see below)
- `status` enum: `registered` | `waiting` | `interviewing` | `interviewed`
- `checked_in_at` (nullable)
- `decision` enum: `undecided` | `selected` | `not_selected` (default `undecided`)
- `created_at`, `updated_at`

`answers` shape. Each section is an ordered list, which keeps question order and allows the same question text to appear in two sections:
```json
{
  "general":   [{ "q": "What motivated you to join Microsoft Club?", "a": "..." }],
  "dev":       [...],
  "logikal":   [...],
  "lnd":       [...],
  "marketing": [...]
}
```

**`queue_entries`**: a row exists only while the candidate is `waiting`
- `candidate_id` (PK)
- `panel_id` (nullable: **null means the waiting pool**, otherwise that panel's lane)
- `position` int: 1..n within its lane, renumbered on every move
- `skip_count` int, `created_at`

**`interviews`**
- `id`, `induction_id`, `candidate_id`, `panel_id`
- `status` enum: `in_progress` | `ended` | `cancelled`
- `started_at` (server time), `ended_at`, `started_by`, `ended_by`
- Partial unique indexes: at most one `in_progress` interview **per panel** and **per candidate**.

**`messages`**
- `id`, `interview_id`, `author_id`, `body` (1–2000 characters), `created_at`

**`evaluation_criteria`**: seeded data, replaceable without code changes
- `id`, `induction_id`, `key`, `label`, `group` (`general` | `team_fit`), `sort_order`

**`evaluations`**
- `id`, `interview_id`, `panelist_id`
- `scores` jsonb: `{criterion_key: 1..5 | null}`
- `recommendation` enum: `strong_yes` | `yes` | `maybe` | `no` (required)
- `comments` text, `submitted_at`, `updated_at`
- Unique `(interview_id, panelist_id)`.

### Placeholder evaluation criteria (seed; to be replaced with the club's real criteria)

- **General (1–5):** Communication, Confidence & Attitude, Teamwork, Commitment, Problem Solving
- **Team fit (1–5 or N/A):** Dev, LogiKal, L&D, Marketing
- **Overall recommendation** (required): Strong Yes / Yes / Maybe / No
- **Comments** (optional)

Only the recommendation is required. Averages ignore blank scores.

## 6. Candidate lifecycle and actions

```
registered ──check in──▶ waiting ──send in──▶ interviewing ──end──▶ interviewed
     ◀──undo check-in──       ◀──undo send-in──        ◀──reopen──
```

Every state change goes through one `SECURITY DEFINER` Postgres function. Each function:
1. checks that the caller's role is allowed and the account is active;
2. validates the current state and raises a clear, user-facing error on conflict;
3. makes all its changes in one transaction;
4. broadcasts once at the end (section 8).

Direct writes to status, queue and interview columns are blocked by RLS.

| Function | Who | Effect |
|---|---|---|
| `import_candidates(rows)` | QM, admin | Section 7 |
| `check_in(candidate_id)` | QM, admin | `registered` → `waiting`. Sets `checked_in_at`. Adds the candidate to the end of the pool. |
| `undo_check_in(candidate_id)` | QM, admin | `waiting` → `registered`. Removes the queue entry and clears `checked_in_at`. |
| `move_candidate(candidate_id, panel_id \| null, position)` | QM, admin | Moves a waiting candidate to any position in the pool or in a panel's lane. Covers reorder, emergency-to-top, lining someone up for a panel, and moving them back to the pool. Renumbers the affected lanes. |
| `skip_candidate(candidate_id)` | QM, admin | Moves the candidate to the end of their current lane and adds 1 to `skip_count`. They stay `waiting`. |
| `send_in(candidate_id, panel_id)` | QM, admin | Candidate must be `waiting`, and the panel must exist and have no `in_progress` interview. Creates an interview with `started_at = now()`, removes the queue entry, and sets the candidate to `interviewing`. If nobody is sitting in the panel, no interview starts: the person is lined up at the front of that panel's lane instead, and the queue board says so. |
| `undo_send_in(interview_id)` | QM, admin | Interview must be `in_progress`. Sets the interview to `cancelled` and the candidate back to `waiting`, at the **top** of that panel's lane. |
| `end_interview(interview_id)` | Panelist (only while sitting in that interview's panel), QM, admin | `in_progress` → `ended`, `ended_at = now()`, candidate → `interviewed`. The panel is free immediately. |
| `reopen_interview(interview_id)` | QM, admin | Only for the panel's most recently ended interview, and only while the panel has no `in_progress` interview. Sets it back to `in_progress` (clears `ended_at`) and the candidate back to `interviewing`. The timer continues from the original `started_at`. |
| `add_panel()` | Admin | Creates "Panel N", where N is the lowest number not in use (a deleted panel keeps its number while the results show its interviews). |
| `delete_panel(panel_id)` | Admin (any panel) | Refused if the panel has an `in_progress` interview. Moves its lane to the end of the pool, then soft-deletes it. Past interviews keep their panel. |
| `set_my_panel(panel_id)` | Panelist, admin | Sets `current_panel_id`. |
| `post_message(interview_id, body)` | Panelist, admin | Inserts a message. |
| `submit_evaluation(interview_id, scores, recommendation, comments)` | Panelist, admin | Creates or updates the caller's evaluation for that interview. Refused after results are published. |
| `set_decision(candidate_id, decision)` | Admin | Sets the decision. |
| `set_results_published(bool)` | Admin | Publishes or unpublishes results. |
| `regenerate_display_key()` | Admin | New projector secret. Old links stop working immediately. |
| `update_settings(name, target_minutes)` | Admin | Induction settings. |

Read functions:
- `board_snapshot()` (staff): panels with current interview, lane, present panelists, and the last ended interview; the pool; status counts.
- `display_snapshot(key)` (public; returns nothing for a wrong key).
- `published_results()` (public; empty unless published).
- `evaluation_count(interview_id)` (panelists, admin): how many panelists have submitted. Panelists can't read other panelists' evaluation rows, so this function supplies the count.
- `results_table()` (admin).
- `server_now()` (anyone; used for clock sync).

## 7. CSV import

**In the browser:**
1. Parse with PapaParse.
2. Validate the header row against the expected layout below: 51 columns, with header text compared after trimming and whitespace normalization. On mismatch, **stop** and show which columns differ. Nothing is imported.
3. Map each row to `{submitted_at, reg_number, full_name, email, account_email, phone, department, batch, preferences[4], answers}` and send all rows in one `import_candidates` call.

**Form layout** (0-based column index into the Fall 2026 export). It lives in one config module (`formLayout.ts`), so next year's form is a config change:

| Columns | Maps to |
|---|---|
| 0 | `submitted_at` (Google Sheets format `M/D/YYYY H:MM:SS`, interpreted as Asia/Karachi) |
| 1 | `account_email` |
| 2 | `full_name` |
| 3 | `email` |
| 4 | `reg_number` |
| 5 | `phone` |
| 6 | `department` |
| 7 | `batch` |
| 8–22 | `answers.general` (motivation through coding experience, including the self-ratings) |
| 23–29 | `answers.dev` |
| 30–35 | `answers.logikal` |
| 36–39 | `answers.lnd` |
| 40–45 | `answers.marketing` |
| 46–49 | `preferences[1..4]` |
| 50 | `answers.general` (appended: "What makes you different…") |

**In the database (`import_candidates`, one transaction, all-or-nothing):**
- Rows with an empty reg number are skipped and flagged.
- If the same reg number appears more than once in the file, the row with the **latest** timestamp supplies the data and the **earliest** timestamp is used for numbering. The row is flagged "duplicate submission".
- **Existing reg number:** update the details, preferences and answers. **Never** change `number`, `status`, `checked_in_at`, `decision`, queue or interview data.
- **New reg number:** insert as `registered`. New candidates are numbered in `submitted_at` order, continuing from the current highest number. The first import therefore gives #1 to the earliest response.
- **New reg number whose email or account email matches an existing candidate:** still inserted, but flagged "possible reg number typo; matches #N".
- **Returns** `{added, updated, flagged: [{reg_number, name, reason}]}`, which the UI shows as an import summary.

## 8. Realtime

Supabase Realtime **Broadcast**. Messages are sent from Postgres with `realtime.send(...)`.

| Topic | Private? | Listeners | Sent when | Payload |
|---|---|---|---|---|
| `board` | Private: RLS on `realtime.messages` allows active staff | QM, panelists, admin | End of every queue, interview or panel action, and after import | `{type}`. Clients reload `board_snapshot()`. |
| `interview:<id>` | Private: active panelists and admins | Panelists viewing that interview | New message; evaluation submitted | The message row, or `{type:'evaluation', count}` |
| `display:<display_key>` | Public; the secret key in the topic is the protection | Projector | Same moments as `board` | The full `display_snapshot`, rendered directly with no extra request |

- **Timer:** every screen computes `elapsed = (clientNow + clockOffset) − started_at` locally, once per second, so there's no network traffic per tick.
  - `clockOffset` comes from `server_now()`: offset = server time + RTT/2 − client time. It is re-synced every 5 minutes.
  - The timer turns amber after `target_interview_minutes`.
- **Resilience:**
  - When a channel (re)subscribes, the screen reloads its full snapshot.
  - Staff screens show a "Reconnecting…" banner while disconnected: at once when the device goes offline, and within about 20 seconds (a missed 10-second heartbeat) when the network stays up but carries nothing.
  - The projector also reloads every 30 seconds as a safety net. While disconnected, it keeps showing the last state with the timer still running, plus a small status dot.
- **Chat:** messages appear instantly for the sender (optimistic) and are reconciled against the saved row. A failed send shows *Retry*, and unsent messages go out by themselves once the connection is back, even if the next candidate was sent in meanwhile (until then, Recent marks that interview "Message not sent"). Each message keeps its id, so it never posts twice.

## 9. Screens

**`/login`**: username + password. After login, users are sent to their role's home: QM → `/queue`, panelist → `/panel`, admin → `/admin`. Routes are guarded by role, and admin can open every screen.

**`/queue`**: queue manager (and admin)
- **Top bar:** counts (Registered · Waiting · Interviewing · Interviewed), search by number, name or reg number, **Import CSV** (opens the import summary), **+ Add panel** (admin only).
- **Candidate lists:** clicking a count opens the full list of candidates with that status (tabs for each status and All), in number order, with where each person is, a filter box, and **Check in** on registered candidates. The list is part of the URL (`/queue?list=registered`), so it can be linked to.
- **Panel cards (one per active panel):**
  - Status: Free (green), or Busy with number, name and live timer.
  - Panelists currently present.
  - Busy: *End interview* and *Undo send-in*.
  - Free after an interview: "Last: #N Name — *Reopen*" until the next send-in.
  - The panel's lane with ↑ ↓ ⤒ (top), *Skip*, *Back to pool*, and **Send in** on the first person while the panel is free.
  - *Delete panel*, shown to admin only.
- **Waiting pool:** ↑ ↓ ⤒, *Line up for ▾ Panel X*, *Send in → Panel X* (when a panel is free), *Skip*, *Undo check-in*, and the skip count.
- **Hint:** if a panel is free and its lane is empty, the first person in the pool is highlighted with "Send in → Panel X".
- **Search results:** show status, with **Check in** for `registered` candidates.

**`/panel`**: panelist
- **Choosing a panel:** pick one on first visit; switch any time from the header.
- **Candidate card:** number, name, reg number, department, batch, preferences 1–4, live timer, **End interview** (only for the panel you are sitting in; admins see it everywhere).
- **Application tabs:** General · Dev · LogiKal · L&D · Marketing · Contact. Empty answers and empty tabs are hidden.
- **Discussion:** the chat for the current interview.
- **My evaluation:** the form, with a draft auto-saved to `localStorage` per interview. It shows how many panelists have submitted.
- **After an interview ends:** chat and evaluation stay open. When the next candidate is sent in, the previous one moves to **Recent**, with a "pending evaluation" badge until this panelist submits.
- **Also:** "Up next" (the first person in this panel's lane), and search to open any candidate's application read-only.
- **On a phone:** three tabs, Application / Chat / Evaluate.

**`/display?key=…`**: projector, no login
- **Dark theme, large type, fits a 16:9 screen.** The layout adapts to 1–4 panels.
- **Each panel tile:** "Now interviewing #N Name" with the timer, or "Free"; below it, up to 3 people lined up for that panel.
- **"Waiting" strip:** the first 8 people in the pool (number + name).
- **Flash:** a tile highlights for about 5 seconds when a new candidate is sent in.
- **Single panel:** `&panel=<id>` shows one panel full screen.
- **Wrong key:** shows "Invalid display link".

**`/admin`**
- **Accounts:** list; create (username, display name, role, password); reset password; disable or enable.
- **Panels:** add, delete any.
- **Settings:** induction name, target interview length, projector link (copy / regenerate).
- **Candidates:** links to each candidate list on the queue board (Registered, Waiting, Interviewing, Interviewed, Everyone).

**`/results`**: admin
- **Table:** number, name, reg number, preferences, status, evaluation count, average of general scores, average per team fit, recommendation tally (e.g. "3 Yes · 1 Maybe"), and the **decision** dropdown. It is sortable and filterable by status and decision.
- **Candidate record** (click a row): answers, every interview (panel, times, duration), full chat transcripts, every evaluation.
- **Export CSV:**
  - (a) one row per candidate: summary and decision;
  - (b) one row per evaluation: candidate, panel, panelist, each score, recommendation, comments, time.
- **Publish results** toggle, with a confirmation. Publishing locks evaluations.

**`/selected`**: public
- When published: selected candidates' names and reg numbers, sorted by name.
- Otherwise: "Results not announced yet".

## 10. Accounts

- Supabase Auth with **signups disabled**. Usernames are mapped to an internal placeholder email. Users only ever see and type their username. The exact domain is chosen during implementation, and email confirmation is off.
- **Edge Function `admin-users`:** create, reset password, and set active. It checks that the caller is an active admin. The service-role key exists only in that function's environment, never in the frontend.
- **Disabling an account:** sets `profiles.is_active = false` and bans the auth user, so existing sessions can't refresh. RLS also checks `is_active`.
- **The first admin** is created with a script (`scripts/create-admin`) using the service-role key: once locally, and once against production.

## 11. Error handling

- Action functions raise short user-facing messages ("Panel 2 is busy", "Candidate is no longer waiting"). The UI shows a toast and reloads the board.
- Action buttons are disabled while their request is running, so a double click does nothing.
- Imports are all-or-nothing, and a header mismatch aborts before any database call.
- A failed chat send shows *Retry*. Evaluation drafts survive a refresh.
- The projector never shows an error page (see section 8).

## 12. Testing

Test-driven: tests are written before each piece.

- **Database (pgTAP via `supabase test db`):**
  - Every action: valid transitions, rejected transitions, conflicts (busy panel, double send-in, sending in a candidate who isn't waiting).
  - Undo and reopen rules. Panel delete rules (QM vs admin, active interview).
  - Import: numbering, updating existing candidates without touching their state, every flag type.
  - RLS:
    - Panelists can't read others' evaluations.
    - The QM can't read messages or evaluations.
    - Anonymous users can read no tables.
    - `display_snapshot` with a wrong key returns nothing.
    - `published_results` is empty until publishing.
- **Unit (Vitest):** CSV header validation and column-to-section mapping, using a **fake** fixture CSV with the real headers. Timestamp parsing. Clock-offset and timer math. Results aggregation.
- **End-to-end (Playwright):** import → check in → line up → send in (projector updates) → two panelists chat → end → both evaluate → results → decide → publish → `/selected` shows the candidate.
- **Local seed:** about 60 fake candidates, plus accounts for 1 admin, 1 QM and 4 panelists.

**Data hygiene:** `*.csv` is gitignored except `fixtures/`. The real export in the repo root is never committed.

## 13. Deployment and induction-day checklist

- **Deploy:**
  - `supabase db push` (migrations) and `supabase functions deploy admin-users`.
  - Cloudflare Pages builds the Vite app, with env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` and SPA fallback routing.
- **Before induction day:**
  - Un-pause the Supabase project.
  - Create or verify accounts.
  - Import the latest CSV.
  - Open the projector link on the projector machine.
  - Do a dry run locally or on a separate free project, not in the production data.

## 14. Out of scope for the MVP (future)

- **Interview slots:** the app generates slots, and candidates view them or look up theirs by reg number. This fits the existing design: candidates are keyed by reg number, and a public `find_my_slot(reg_number)` function would work like `published_results()`, returning only that one candidate's slot.
- Drag-and-drop queue (the MVP uses ↑ ↓ ⤒ buttons).
- A UI for creating or switching inductions, and a UI for editing evaluation criteria.
- Google Forms/Sheets API sync, notifications (SMS, WhatsApp, email), candidate self check-in or QR codes.
- Analytics (average interview time, panel stats), audit logs, multiple interview rounds.
