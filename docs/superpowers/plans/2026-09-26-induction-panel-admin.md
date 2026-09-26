# Induction System — Plan 3 of 3: Panelist Screen, Admin, Results, Public Results, E2E and Deployment

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the induction system:
- the panelist screen `/panel`: the application, the panel's live discussion and each panelist's own evaluation;
- the full `/admin`: accounts, panels, settings and the projector link;
- `/results`, with the complete record of each candidate, both CSV exports and publishing;
- the public `/selected` page;
- a Playwright test of the whole induction day;
- the guide for deploying to Supabase Cloud and Cloudflare Pages.

**Architecture:** Same shape as Plan 2. Every screen reads through the typed `Api` object (`src/lib/api.ts`) and stays current with `useLiveSnapshot`:
- `/panel` follows the private `board` topic. For the interview on show it also follows the private `interview:<id>` topic, with one subscription per interview that feeds both the chat and the "N panelists have submitted" count.
- Account changes go through the Plan 1 `admin-users` edge function (`supabase.functions.invoke`). Everything else calls Plan 1 database functions or reads tables through row-level security.
- Sorting, filtering and the CSV exports on `/results` run in the browser.
- One small migration makes publishing results broadcast to the board, so open panelist screens lock their evaluation forms straight away.

**Tech Stack:** As Plan 2 (React 19.3, React Router 8.4, Vite 8.3, Tailwind CSS 4.3, TypeScript 7.0, PapaParse 5.7, `@supabase/supabase-js` 2.117, Vitest 5 with jsdom 30 and Testing Library), plus `@playwright/test` 1.63.0 (Chromium only).

**Spec:** `docs/superpowers/specs/2026-09-25-induction-system-design.md` (§4 roles, §5 evaluations, §8 realtime, §9 `/panel`, `/admin`, `/results`, `/selected`, §10 accounts, §11 errors, §12 end-to-end test, §13 deployment and induction-day checklist). Plans 1 and 2 are merged.

**Roadmap:**
1. Backend (done, PR #1).
2. Frontend foundation, Queue Manager, Projector (done, PR #2).
3. **Panelist screen, Admin, Results, `/selected`, E2E and deployment** (this plan).

## Global Constraints

- **Everything in Plan 2's Global Constraints still holds:**
  - stack and $0 hosting;
  - only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the browser;
  - no global state library;
  - reload the snapshot whenever a channel (re)subscribes;
  - a toast and a reload when an action fails;
  - action buttons disabled while their request runs;
  - the CSV hygiene rules.
- **Backend: one new migration, nothing else.** Task 1 adds a migration that makes `set_results_published` broadcast `changed` on `board`. Plan 1's functions are otherwise used as they are:
  - `set_my_panel`, `interview_messages`, `post_message` (it takes the message id from the browser), `evaluation_count`, `submit_evaluation`;
  - `update_settings`, `regenerate_display_key`;
  - `results_table`, `candidate_record`, `evaluations_export`, `set_decision`, `set_results_published`, `published_results`;
  - reads, through row-level security, of `candidates`, `interviews`, `evaluation_criteria`, `evaluations`, `profiles` and `inductions`.
- **Accounts only through `admin-users`** (spec §10). The browser sends `AdminUsersCommand` objects (`supabase/functions/admin-users/validate.ts`) with the signed-in admin's token and checks each one first with the same `validateCommand`. The service-role key stays in the function's environment.
- **Evaluation rules (spec §5):**
  - only the recommendation is required;
  - a criterion left without a score or marked N/A is left out of `scores`;
  - comments are at most 5000 characters;
  - once results are published the server refuses changes, and the form turns read-only.
  - Drafts live in `localStorage` under `induction:evaluation-draft:<userId>:<interviewId>`, so panelists sharing a laptop never see each other's drafts. A draft is cleared when it is submitted.
- **Chat (spec §11):** a message shows at once as "Sending…". A failed send shows **Retry**. The browser makes the message id (`crypto.randomUUID()`), so a retry after a lost response never posts twice.
- **CSV exports:** PapaParse output with a UTF-8 byte-order mark, so Excel shows Urdu names correctly. Any cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'`, so a spreadsheet never runs text from the public form as a formula.
- **Hardening carried over from the Plan 2 final review (Task 3):**
  - channels the server closes are rejoined, waiting 1 s, 2 s, 5 s and then 10 s between tries;
  - every top-level route has an `errorElement`: the projector shows "Connecting…" and reloads itself, and staff screens offer a reload;
  - a deliberate "Sign out" goes to a plain `/login`, without `?next=`.
- **Decided (spec silent):**
  - Publishing results asks for confirmation; so do unpublishing, disabling an account, making a new projector link and deleting a panel.
  - Enabling an account and recording a decision happen at once.
  - Nobody can disable their own account from the page.
  - Generated passwords are 12 characters from an alphabet without look-alikes (no `l`/`1`, `o`/`0` or `i`).
- **Decided (spec silent):** the "Evaluation pending" badge on `/panel` marks every recent interview on the panel that this panelist has not evaluated, including interviews from before they joined the panel. The list shows the panel's latest 30 interviews.
- **Decided (spec silent):** `/results` is read after the interviews, so it does not follow the `board` topic. It reloads after every decision or publish and has a **Refresh** button.
- **Decided (spec silent):** `/selected` says "Results not announced yet" both before publishing and when results are published with nobody selected. `published_results()` returns an empty list in both cases and does not reveal the flag to visitors.
- **Not in this plan:** renaming buttons so that each accessible name contains its visible text (a Plan 2 review minor). Candidate slots and candidate logins are out of scope (spec §14).
- **Test runs against the local stack only.** Never run `db:test`, `db:reset` or any test suite against a linked production project (Plan 1 decision: the tests schema exposes helper functions).
- **Local machine:** the disk is nearly full.
  - Add no dependencies beyond `@playwright/test` (Task 11) and pull no Docker images.
  - Playwright uses the Chromium already in `~/.cache/ms-playwright`. If it is missing there, stop and ask before downloading a browser.
- **Tests:**
  - Component tests start with `// @vitest-environment jsdom`.
  - Shared fakes live in `tests/unit/web/helpers.tsx` (`fakeApi()`, `fakeAuth()`, `renderApp()`) and data in `tests/unit/web/fixtures.ts`.
  - Integration and E2E tests need `npm run db:start`, `npm run seed:dev` and `npm run functions:serve` (a second terminal). E2E also needs `.env.local` from `npm run web:env`.

## Review Focus

These are the induction-day failure modes this plan's code is most likely to hit. A test pins each one in the task that owns the code:

1. **Two panelists in one room, one of them on a phone with patchy Wi-Fi.**
   - Every panelist sees the other's messages live, and the "N panelists have submitted" count is live too.
   - A message that fails to send stays on screen with **Retry**, and retrying never posts it twice.
   - An evaluation draft survives a reload and a dropped connection.
   - Pinned in Task 5 (chat) and Task 6 (drafts and the form).
2. **The next candidate is sent in while a panelist is still writing their evaluation.** The previous interview moves to **Recent** with an "Evaluation pending" badge. Opening it brings back the draft, and "Back to the current interview" returns to the new candidate. Pinned in Task 7.
3. **Results are published while a panelist has the form open.** The form turns read-only straight away, because publishing now broadcasts on `board`. Pinned in Task 1 (the broadcast) and Tasks 6 and 7 (the read-only form).
4. **A disabled account, or a refused or unreachable `admin-users` function.**
   - The function's own message is shown ("Username already taken").
   - A 401/403 signs the admin out the same way "Not allowed" does.
   - A network failure reads as a connection problem.
   - Pinned in Task 2.
5. **Text from the public Google Form in the results.**
   - A name or comment starting with `=` does not run as a formula in a spreadsheet.
   - A reg number typed with spaces or in lower case still finds the candidate on `/results` and on `/selected`.
   - Pinned in Tasks 9 and 10.
6. **The projector or a staff screen hits a render error, or the server closes a channel.** The projector never shows React Router's error page: it shows "Connecting…" and reloads itself. Closed channels are rejoined. Pinned in Task 3.

---

### Task 1: Publishing results tells the staff board

**Files:**
- Create: `supabase/migrations/20260926000100_publish_broadcast.sql`
- Test: `supabase/tests/100_publish_broadcast.test.sql`

**Interfaces:**
- Consumes: Plan 1's `set_results_published(p_published)`, `broadcast_board()`, `board_snapshot()`, and the pgTAP helpers `tests.reset_app()`, `tests.create_user()`, `tests.login_as()`, `tests.as_postgres()`.
- Produces:
  - `set_results_published(p_published boolean)` now also broadcasts `changed` on `board`, like every other state change.
  - Its signature, grants and checks are unchanged.

- [ ] **Step 1: Write the failing test**

`supabase/tests/100_publish_broadcast.test.sql`:

```sql
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run db:test`
Expected:
- `100_publish_broadcast.test.sql` reports `not ok 1 - publishing results tells the staff board` and `not ok 3 - unpublishing results tells the staff board too`.
- The run ends with `Result: FAIL`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/20260926000100_publish_broadcast.sql`:

```sql
-- Publishing or unpublishing results changes what panelists may do (evaluations lock), so the
-- staff board is told, the same way every other state change is. Grants are unchanged.
create or replace function public.set_results_published(p_published boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public.require_role('admin');
  update public.inductions set results_published = coalesce(p_published, false) where is_active;
  if not found then
    raise exception 'No active induction';
  end if;
  perform public.broadcast_board();
end $$;
```

- [ ] **Step 4: Apply it and run every database test**

Run: `npm run db:reset && npm run db:test && npm run seed:dev`
Expected:
- `Result: PASS`, with `Tests=199` (196 from Plan 1 plus 3).
- `seed:dev` puts the dev accounts and candidates back.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260926000100_publish_broadcast.sql supabase/tests/100_publish_broadcast.test.sql
git commit -m "feat(db): publishing results tells the staff board"
```

---

### Task 2: API calls for the panelist screen, admin and results

**Files:**
- Modify: `src/lib/types.ts`, `src/lib/api.ts`, `tests/unit/web/fixtures.ts`, `tests/unit/web/helpers.tsx`, `tests/unit/web/api.test.ts`
- Test: `tests/unit/web/api.test.ts`, `tests/integration/web-panel-admin.test.ts`

**Interfaces:**
- Consumes:
  - Plan 1 functions: `set_my_panel(p_panel_id)`, `interview_messages(p_interview_id)`, `post_message(p_interview_id, p_body, p_id)`, `evaluation_count(p_interview_id)`, `submit_evaluation(p_interview_id, p_scores, p_recommendation, p_comments)`, `update_settings(p_name, p_target_minutes)`, `regenerate_display_key()`, `results_table()`, `candidate_record(p_candidate_id)`, `evaluations_export()`, `set_decision(p_candidate_id, p_decision)`, `set_results_published(p_published)`, `published_results()`.
  - Tables read through row-level security: `candidates`, `interviews`, `evaluation_criteria`, `evaluations`, `profiles`, `inductions`.
  - The `admin-users` edge function and its `AdminUsersCommand` type.
  - Topic `interview:<id>` (private).
- Produces:
  - Types in `src/lib/types.ts`: `Decision`, `Recommendation`, `InterviewStatus`, `Candidate`, `PanelInterview`, `ChatMessage`, `Criterion`, `Scores`, `MyEvaluation`, `Account`, `InductionSettings`, `ResultRow`, `RecordEvaluation`, `RecordInterview`, `CandidateRecord`, `EvaluationExportRow`, `PublishedResult`.
  - New `Api` methods:
    - Panelists: `setMyPanel`, `candidate`, `panelInterviews`, `criteria`, `interviewMessages`, `postMessage`, `evaluationCount`, `myEvaluations`, `submitEvaluation`, `subscribeInterview`.
    - Admins: `listAccounts`, `manageAccount`, `induction`, `updateSettings`, `regenerateDisplayKey`, `resultsTable`, `candidateRecord`, `evaluationsExport`, `setDecision`, `setResultsPublished`.
    - Anyone: `publishedResults`.
  - `manageAccount` failures:
    - The function's `{ error }` message is shown as it is.
    - A 401 or 403 becomes `NOT_ALLOWED` and emits `notAllowed`.
    - A timeout becomes `TIMEOUT_ERROR`.
    - Anything else becomes `NETWORK_ERROR`.
  - Test fixtures `candidateRow()`, `criteriaList()`, `resultRow()`, `candidateRecordFor()`.
  - `fakeApi()` defaults for every new method, plus `topics.interview`.

- [ ] **Step 1: Write the failing unit tests**

Replace `tests/unit/web/api.test.ts` with:

```ts
import { createClient, FunctionsFetchError, FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi, friendlyMessage, NETWORK_ERROR, NOT_ALLOWED, TIMEOUT_ERROR } from '../../../src/lib/api.ts';
import { notAllowed } from '../../../src/lib/notAllowed.ts';

/** Stands in for a postgrest-js query: awaitable, with .abortSignal(). */
function query(result: Promise<unknown>) {
  return { abortSignal: () => result };
}

function clientReturning(response: { data?: unknown; error?: { message: string; code?: string } | null; status?: number }) {
  const rpc = vi.fn(() => query(Promise.resolve({ data: null, error: null, status: 200, ...response })));
  return { rpc, client: { rpc } as unknown as SupabaseClient };
}

describe('friendlyMessage', () => {
  it('passes the database message through', () => {
    expect(friendlyMessage({ message: 'Panel 2 is busy', code: 'P0001' }, 400)).toBe('Panel 2 is busy');
  });
  it('maps permission errors and network failures', () => {
    expect(friendlyMessage({ message: 'Not allowed', code: '42501' }, 403)).toBe(NOT_ALLOWED);
    expect(friendlyMessage({ message: 'permission denied for table candidates', code: '42501' }, 401)).toBe(NOT_ALLOWED);
    expect(friendlyMessage({ message: 'TypeError: Failed to fetch', code: '' }, 0)).toBe(NETWORK_ERROR);
    expect(friendlyMessage({ message: '' }, 500)).toBe('Something went wrong');
  });
});

describe('createApi', () => {
  it('calls each database function with its argument names', async () => {
    const { rpc, client } = clientReturning({ data: 'interview-1' });
    const api = createApi(client);
    await expect(api.sendIn('c1', 'p1')).resolves.toBe('interview-1');
    await api.moveCandidate('c1', null, null);
    await api.importCandidates([]);
    expect(rpc.mock.calls).toEqual([
      ['send_in', { p_candidate_id: 'c1', p_panel_id: 'p1' }],
      ['move_candidate', { p_candidate_id: 'c1', p_panel_id: null, p_position: null }],
      ['import_candidates', { p_rows: [] }],
    ]);
  });

  it('rejects with the server message', async () => {
    const api = createApi(clientReturning({ error: { message: 'Candidate #4 is not waiting', code: 'P0001' }, status: 400 }).client);
    await expect(api.checkIn('c4')).rejects.toEqual(new ApiError('Candidate #4 is not waiting'));
  });

  it('announces "Not allowed" so a disabled account gets signed out', async () => {
    const listener = vi.fn();
    const stop = notAllowed.subscribe(listener);
    const api = createApi(clientReturning({ error: { message: 'Not allowed', code: '42501' }, status: 403 }).client);
    await expect(api.boardSnapshot()).rejects.toThrow(NOT_ALLOWED);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it('turns a thrown fetch into the network message', async () => {
    const rpc = vi.fn(() => query(Promise.reject(new TypeError('Failed to fetch'))));
    const api = createApi({ rpc } as unknown as SupabaseClient);
    await expect(api.serverNow()).rejects.toThrow(NETWORK_ERROR);
  });

  it('gives up on a call that takes too long, instead of waiting forever', async () => {
    // A real supabase-js client whose requests never get an answer (e.g. the venue's uplink stalls).
    const stalled: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
    const client = createClient('http://127.0.0.1:9', 'anon-key', { auth: { persistSession: false }, global: { fetch: stalled } });
    const api = createApi(client, { timeoutMs: 50 });
    await expect(api.boardSnapshot()).rejects.toThrow(TIMEOUT_ERROR);
    await expect(api.listCandidates('ind-1')).rejects.toThrow(TIMEOUT_ERROR);
  }, 3000);
});

describe('panelist, admin and results calls', () => {
  it('call each database function with its argument names', async () => {
    const { rpc, client } = clientReturning({ data: null });
    const api = createApi(client);
    await api.setMyPanel('p1');
    await api.setMyPanel(null);
    await api.postMessage('i1', 'Strong answers', 'm1');
    await api.submitEvaluation('i1', { communication: 4 }, 'yes', 'Good');
    await api.updateSettings('Fall 2026', 20);
    await api.setDecision('c1', 'selected');
    await api.setResultsPublished(true);
    expect(rpc.mock.calls).toEqual([
      ['set_my_panel', { p_panel_id: 'p1' }],
      ['set_my_panel', { p_panel_id: null }],
      ['post_message', { p_interview_id: 'i1', p_body: 'Strong answers', p_id: 'm1' }],
      ['submit_evaluation', { p_interview_id: 'i1', p_scores: { communication: 4 }, p_recommendation: 'yes', p_comments: 'Good' }],
      ['update_settings', { p_name: 'Fall 2026', p_target_minutes: 20 }],
      ['set_decision', { p_candidate_id: 'c1', p_decision: 'selected' }],
      ['set_results_published', { p_published: true }],
    ]);
  });
});

describe('manageAccount', () => {
  function functionsClient(result: { data: unknown; error: unknown }) {
    const invoke = vi.fn(async () => result);
    return { invoke, client: { functions: { invoke } } as unknown as SupabaseClient };
  }

  it('sends the command to the admin-users edge function', async () => {
    const { invoke, client } = functionsClient({ data: { ok: true }, error: null });
    await createApi(client).manageAccount({ action: 'set_active', userId: 'u1', active: false });
    expect(invoke).toHaveBeenCalledWith('admin-users', expect.objectContaining({ body: { action: 'set_active', userId: 'u1', active: false } }));
  });

  it("shows the function's own message", async () => {
    const error = new FunctionsHttpError(new Response(JSON.stringify({ error: 'Username already taken' }), { status: 400 }));
    const { client } = functionsClient({ data: null, error });
    await expect(
      createApi(client).manageAccount({ action: 'create', username: 'hina', displayName: 'Hina', role: 'panelist', password: 'long-enough' }),
    ).rejects.toEqual(new ApiError('Username already taken'));
  });

  it('treats a refusal as "Not allowed" and announces it', async () => {
    const listener = vi.fn();
    const stop = notAllowed.subscribe(listener);
    const error = new FunctionsHttpError(new Response(JSON.stringify({ error: 'Not allowed' }), { status: 403 }));
    const { client } = functionsClient({ data: null, error });
    await expect(createApi(client).manageAccount({ action: 'set_active', userId: 'u1', active: true })).rejects.toThrow(NOT_ALLOWED);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it('reports an unreachable function as a network problem', async () => {
    const { client } = functionsClient({ data: null, error: new FunctionsFetchError(new TypeError('Failed to fetch')) });
    await expect(createApi(client).manageAccount({ action: 'set_active', userId: 'u1', active: true })).rejects.toThrow(NETWORK_ERROR);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/unit/web/api.test.ts`
Expected:
- FAIL: 5 of the 12 tests fail, with `TypeError: api.setMyPanel is not a function` and `TypeError: … manageAccount is not a function`.
- The 7 existing tests still pass.

- [ ] **Step 3: Add the types and the API calls**

Append to `src/lib/types.ts`:

```ts
// ---- Panelist, admin and results screens (Plan 3) ----

export type Decision = 'undecided' | 'selected' | 'not_selected';
export type Recommendation = 'strong_yes' | 'yes' | 'maybe' | 'no';
export type InterviewStatus = 'in_progress' | 'ended' | 'cancelled';

/** A full candidates row, as panelists and admins read it. */
export interface Candidate {
  id: string;
  number: number;
  reg_number: string;
  full_name: string;
  email: string;
  account_email: string;
  phone: string;
  department: string;
  batch: string;
  submitted_at: string;
  preferences: string[];
  /** Sections the form had; an import may leave a section out. */
  answers: Partial<Record<AnswerSection, Answer[]>>;
  status: CandidateStatus;
  checked_in_at: string | null;
  decision: Decision;
}

/** One interview on a panel, newest first (the panelist's current and recent interviews). */
export interface PanelInterview {
  id: string;
  status: InterviewStatus;
  started_at: string;
  ended_at: string | null;
  candidate: { id: string; number: number; full_name: string };
}

export interface ChatMessage {
  id: string;
  interview_id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
}

export interface Criterion {
  key: string;
  label: string;
  category: 'general' | 'team_fit';
  sort_order: number;
}

/** Scores by criterion key, 1–5. A missing key means N/A or not scored. */
export type Scores = Record<string, number>;

export interface MyEvaluation {
  interview_id: string;
  scores: Scores;
  recommendation: Recommendation;
  comments: string;
  updated_at: string;
}

export type Account = Profile;

export interface InductionSettings {
  id: string;
  name: string;
  target_interview_minutes: number;
  results_published: boolean;
}

/** One row of results_table(). Averages are null when nobody gave a score. */
export interface ResultRow {
  candidate_id: string;
  number: number;
  reg_number: string;
  full_name: string;
  department: string;
  batch: string;
  preferences: string[];
  status: CandidateStatus;
  decision: Decision;
  evaluation_count: number;
  general_avg: number | null;
  criteria_avgs: Record<string, number>;
  recommendations: Partial<Record<Recommendation, number>>;
}

export interface RecordEvaluation {
  panelist_name: string;
  scores: Scores;
  recommendation: Recommendation;
  comments: string;
  submitted_at: string;
  updated_at: string;
}

export interface RecordInterview {
  id: string;
  panel_name: string;
  status: InterviewStatus;
  started_at: string;
  ended_at: string | null;
  messages: ChatMessage[];
  evaluations: RecordEvaluation[];
}

/** candidate_record(): everything about one candidate, for admins. */
export interface CandidateRecord {
  candidate: Candidate & { created_at: string; updated_at: string };
  interviews: RecordInterview[];
}

/** One row of evaluations_export(). */
export interface EvaluationExportRow {
  number: number;
  reg_number: string;
  full_name: string;
  panel: string;
  panelist: string;
  scores: Scores;
  recommendation: Recommendation;
  comments: string;
  submitted_at: string;
}

export interface PublishedResult {
  full_name: string;
  reg_number: string;
}
```

Replace `src/lib/api.ts` with:

```ts
import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import type { AdminUsersCommand } from '../../supabase/functions/admin-users/validate.ts';
import { notAllowed } from './notAllowed.ts';
import { broadcastSubscriber, type Subscribe } from './realtime.ts';
import type {
  Account,
  BoardSnapshot,
  Candidate,
  CandidateRecord,
  CandidateSummary,
  ChatMessage,
  Criterion,
  Decision,
  DisplaySnapshot,
  EvaluationExportRow,
  ImportResult,
  ImportRow,
  InductionSettings,
  MyEvaluation,
  PanelInterview,
  PublishedResult,
  Recommendation,
  ResultRow,
  Scores,
} from './types.ts';

const CANDIDATE_COLUMNS =
  'id, number, reg_number, full_name, email, account_email, phone, department, batch, submitted_at, preferences, answers, status, checked_in_at, decision';

export const NETWORK_ERROR = "Can't reach the server. Check the connection and try again.";
export const TIMEOUT_ERROR = 'The server took too long to answer. Check the board before trying again.';
export const NOT_ALLOWED = 'Not allowed';

/** An action or read failed; `message` is safe to show (usually the database's own short message). */
export class ApiError extends Error {}

export function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Something went wrong';
}

/** Turns a PostgREST/Postgres error into the message a person should see. */
export function friendlyMessage(error: { message?: string; code?: string }, status?: number): string {
  if (error.code === '42501') return NOT_ALLOWED; // require_role() and RLS both use this code
  if (status === 0 || /failed to fetch|fetch failed|networkerror/i.test(error.message ?? '')) return NETWORK_ERROR;
  return error.message?.trim() || 'Something went wrong';
}

/** Every call the screens make. One object per client; its methods are stable for React deps. */
export interface Api {
  boardSnapshot(): Promise<BoardSnapshot>;
  /** null for a wrong or regenerated projector key. */
  displaySnapshot(key: string): Promise<DisplaySnapshot | null>;
  serverNow(): Promise<string>;
  listCandidates(inductionId: string): Promise<CandidateSummary[]>;
  getDisplayKey(): Promise<string>;
  checkIn(candidateId: string): Promise<void>;
  undoCheckIn(candidateId: string): Promise<void>;
  /** panelId null = the waiting pool; position null = end of the lane. */
  moveCandidate(candidateId: string, panelId: string | null, position: number | null): Promise<void>;
  skipCandidate(candidateId: string): Promise<void>;
  /** Returns the new interview's id. */
  sendIn(candidateId: string, panelId: string): Promise<string>;
  undoSendIn(interviewId: string): Promise<void>;
  endInterview(interviewId: string): Promise<void>;
  reopenInterview(interviewId: string): Promise<void>;
  /** Returns the new panel's id. */
  addPanel(): Promise<string>;
  deletePanel(panelId: string): Promise<void>;
  importCandidates(rows: ImportRow[]): Promise<ImportResult>;
  subscribeBoard(): Subscribe;
  subscribeDisplay(key: string): Subscribe;

  // Panelists (and admins on /panel)
  /** null = not sitting in any panel. */
  setMyPanel(panelId: string | null): Promise<void>;
  candidate(candidateId: string): Promise<Candidate>;
  /** The panel's interviews, newest first (cancelled ones left out). */
  panelInterviews(panelId: string): Promise<PanelInterview[]>;
  criteria(inductionId: string): Promise<Criterion[]>;
  interviewMessages(interviewId: string): Promise<ChatMessage[]>;
  /** `id` comes from the browser so a retry after a failed send can't post twice. */
  postMessage(interviewId: string, body: string, id: string): Promise<ChatMessage>;
  evaluationCount(interviewId: string): Promise<number>;
  /** This person's own evaluations (admins can read everyone's, hence the explicit user id). */
  myEvaluations(userId: string): Promise<MyEvaluation[]>;
  submitEvaluation(interviewId: string, scores: Scores, recommendation: Recommendation, comments: string): Promise<void>;
  subscribeInterview(interviewId: string): Subscribe;

  // Admins
  listAccounts(): Promise<Account[]>;
  /** Create, reset a password, disable or enable, through the admin-users edge function. */
  manageAccount(command: AdminUsersCommand): Promise<void>;
  induction(): Promise<InductionSettings>;
  updateSettings(name: string, targetMinutes: number): Promise<void>;
  /** Returns the new projector key; old links stop working at once. */
  regenerateDisplayKey(): Promise<string>;
  resultsTable(): Promise<ResultRow[]>;
  candidateRecord(candidateId: string): Promise<CandidateRecord>;
  evaluationsExport(): Promise<EvaluationExportRow[]>;
  setDecision(candidateId: string, decision: Decision): Promise<void>;
  setResultsPublished(published: boolean): Promise<void>;

  // Anyone
  publishedResults(): Promise<PublishedResult[]>;
}

export interface ApiOptions {
  /** Give up on a call after this long, so one stalled request can't hold up every later reload. */
  timeoutMs?: number;
  /** import_candidates handles hundreds of rows in one transaction; it gets longer. */
  importTimeoutMs?: number;
}

type QueryResponse = { data: unknown; error: { message?: string; code?: string } | null; status: number };

export function createApi(client: SupabaseClient, { timeoutMs = 15_000, importTimeoutMs = 60_000 }: ApiOptions = {}): Api {
  function fail(error: { message?: string; code?: string }, status?: number): ApiError {
    const message = friendlyMessage(error, status);
    if (message === NOT_ALLOWED) notAllowed.emit();
    return new ApiError(message);
  }

  /** Runs one query with a deadline. An action that times out may still have gone through, hence the message. */
  async function send<T>(query: (signal: AbortSignal) => PromiseLike<QueryResponse>, limitMs = timeoutMs): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limitMs);
    let response: QueryResponse;
    try {
      response = await query(controller.signal);
    } catch {
      throw new ApiError(controller.signal.aborted ? TIMEOUT_ERROR : NETWORK_ERROR);
    } finally {
      clearTimeout(timer);
    }
    if (controller.signal.aborted) throw new ApiError(TIMEOUT_ERROR);
    if (response.error) throw fail(response.error, response.status);
    return response.data as T;
  }

  const rpc = <T,>(fn: string, args?: Record<string, unknown>, limitMs?: number) =>
    send<T>((signal) => client.rpc(fn, args).abortSignal(signal), limitMs);

  return {
    boardSnapshot: () => rpc<BoardSnapshot>('board_snapshot'),
    displaySnapshot: (key) => rpc<DisplaySnapshot | null>('display_snapshot', { p_key: key }),
    serverNow: () => rpc<string>('server_now'),
    listCandidates: (inductionId) =>
      send<CandidateSummary[]>((signal) =>
        client
          .from('candidates')
          .select('id, number, full_name, reg_number, status')
          .eq('induction_id', inductionId)
          .order('number')
          .abortSignal(signal),
      ),
    getDisplayKey: () => rpc<string>('get_display_key'),
    checkIn: (candidateId) => rpc<void>('check_in', { p_candidate_id: candidateId }),
    undoCheckIn: (candidateId) => rpc<void>('undo_check_in', { p_candidate_id: candidateId }),
    moveCandidate: (candidateId, panelId, position) =>
      rpc<void>('move_candidate', { p_candidate_id: candidateId, p_panel_id: panelId, p_position: position }),
    skipCandidate: (candidateId) => rpc<void>('skip_candidate', { p_candidate_id: candidateId }),
    sendIn: (candidateId, panelId) => rpc<string>('send_in', { p_candidate_id: candidateId, p_panel_id: panelId }),
    undoSendIn: (interviewId) => rpc<void>('undo_send_in', { p_interview_id: interviewId }),
    endInterview: (interviewId) => rpc<void>('end_interview', { p_interview_id: interviewId }),
    reopenInterview: (interviewId) => rpc<void>('reopen_interview', { p_interview_id: interviewId }),
    addPanel: () => rpc<string>('add_panel'),
    deletePanel: (panelId) => rpc<void>('delete_panel', { p_panel_id: panelId }),
    importCandidates: (rows) => rpc<ImportResult>('import_candidates', { p_rows: rows }, importTimeoutMs),
    subscribeBoard: () => broadcastSubscriber(client, 'board', true),
    subscribeDisplay: (key) => broadcastSubscriber(client, `display:${key}`, false),

    setMyPanel: (panelId) => rpc<void>('set_my_panel', { p_panel_id: panelId }),
    async candidate(candidateId) {
      const row = await send<Candidate | null>((signal) =>
        client.from('candidates').select(CANDIDATE_COLUMNS).eq('id', candidateId).abortSignal(signal).maybeSingle(),
      );
      if (!row) throw new ApiError('Candidate not found');
      return row;
    },
    panelInterviews: (panelId) =>
      send<PanelInterview[]>((signal) =>
        client
          .from('interviews')
          .select('id, status, started_at, ended_at, candidate:candidates(id, number, full_name)')
          .eq('panel_id', panelId)
          .neq('status', 'cancelled')
          .order('started_at', { ascending: false })
          .limit(30)
          .abortSignal(signal),
      ),
    criteria: (inductionId) =>
      send<Criterion[]>((signal) =>
        client
          .from('evaluation_criteria')
          .select('key, label, category, sort_order')
          .eq('induction_id', inductionId)
          .order('sort_order')
          .abortSignal(signal),
      ),
    interviewMessages: (interviewId) => rpc<ChatMessage[]>('interview_messages', { p_interview_id: interviewId }),
    postMessage: (interviewId, body, id) =>
      rpc<ChatMessage>('post_message', { p_interview_id: interviewId, p_body: body, p_id: id }),
    evaluationCount: (interviewId) => rpc<number>('evaluation_count', { p_interview_id: interviewId }),
    myEvaluations: (userId) =>
      send<MyEvaluation[]>((signal) =>
        client
          .from('evaluations')
          .select('interview_id, scores, recommendation, comments, updated_at')
          .eq('panelist_id', userId)
          .abortSignal(signal),
      ),
    submitEvaluation: (interviewId, scores, recommendation, comments) =>
      rpc<void>('submit_evaluation', {
        p_interview_id: interviewId,
        p_scores: scores,
        p_recommendation: recommendation,
        p_comments: comments,
      }),
    subscribeInterview: (interviewId) => broadcastSubscriber(client, `interview:${interviewId}`, true),

    listAccounts: () =>
      send<Account[]>((signal) =>
        client
          .from('profiles')
          .select('id, username, display_name, role, is_active, current_panel_id')
          .order('username')
          .abortSignal(signal),
      ),
    async manageAccount(command) {
      let result;
      try {
        result = await client.functions.invoke('admin-users', { body: command, timeout: timeoutMs });
      } catch {
        throw new ApiError(NETWORK_ERROR);
      }
      const { error } = result;
      if (!error) return;
      if (error instanceof FunctionsHttpError) {
        const response = error.context as Response;
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        const message = response.status === 401 || response.status === 403 ? NOT_ALLOWED : body?.error?.trim() || 'Something went wrong';
        if (message === NOT_ALLOWED) notAllowed.emit();
        throw new ApiError(message);
      }
      const cause = (error as { context?: { name?: string } }).context;
      throw new ApiError(cause?.name === 'AbortError' || cause?.name === 'TimeoutError' ? TIMEOUT_ERROR : NETWORK_ERROR);
    },
    async induction() {
      const row = await send<InductionSettings | null>((signal) =>
        client
          .from('inductions')
          .select('id, name, target_interview_minutes, results_published')
          .eq('is_active', true)
          .abortSignal(signal)
          .maybeSingle(),
      );
      if (!row) throw new ApiError('No active induction');
      return row;
    },
    updateSettings: (name, targetMinutes) =>
      rpc<void>('update_settings', { p_name: name, p_target_minutes: targetMinutes }),
    regenerateDisplayKey: () => rpc<string>('regenerate_display_key'),
    resultsTable: () => rpc<ResultRow[]>('results_table'),
    candidateRecord: (candidateId) => rpc<CandidateRecord>('candidate_record', { p_candidate_id: candidateId }),
    evaluationsExport: () => rpc<EvaluationExportRow[]>('evaluations_export'),
    setDecision: (candidateId, decision) => rpc<void>('set_decision', { p_candidate_id: candidateId, p_decision: decision }),
    setResultsPublished: (published) => rpc<void>('set_results_published', { p_published: published }),

    publishedResults: () => rpc<PublishedResult[]>('published_results'),
  };
}
```

- [ ] **Step 4: Give the test fakes the new calls and data**

Replace `tests/unit/web/fixtures.ts` with:

```ts
// Test data shaped like the database functions' output (see src/lib/types.ts).
import type {
  BoardPanel,
  BoardSnapshot,
  Candidate,
  CandidateRecord,
  Criterion,
  CurrentInterview,
  DisplaySnapshot,
  LaneEntry,
  Profile,
  ResultRow,
  Role,
} from '../../../src/lib/types.ts';

const reg = (number: number) => `2025${String(number).padStart(3, '0')}`;

export function lane(...people: Array<[number, string]>): LaneEntry[] {
  return people.map(([number, name], i) => ({
    candidate_id: `c${number}`,
    number,
    name,
    reg_number: reg(number),
    position: i + 1,
    skip_count: 0,
    checked_in_at: '2026-09-26T09:00:00Z',
  }));
}

export function interview(number: number, name: string, startedAt = '2026-09-26T09:50:00Z'): CurrentInterview {
  return { interview_id: `i${number}`, candidate_id: `c${number}`, number, name, reg_number: reg(number), started_at: startedAt };
}

export function boardPanel(id: string, name: string, overrides: Partial<BoardPanel> = {}): BoardPanel {
  return { id, name, is_default: false, current: null, last_ended: null, lane: [], panelists: [], ...overrides };
}

/** Panel 1 busy with #7, Panel 2 free with #12 lined up, three people in the pool. */
export function board(overrides: Partial<BoardSnapshot> = {}): BoardSnapshot {
  return {
    induction: { id: 'ind-1', name: 'Fall 2026', target_interview_minutes: 15, results_published: false },
    server_time: '2026-09-26T10:00:00Z',
    counts: { registered: 40, waiting: 4, interviewing: 1, interviewed: 16 },
    panels: [
      boardPanel('p1', 'Panel 1', { is_default: true, current: interview(7, 'Sara Ahmed'), panelists: [{ id: 'u1', display_name: 'Hamza' }, { id: 'u2', display_name: 'Mariam' }] }),
      boardPanel('p2', 'Panel 2', { is_default: true, lane: lane([12, 'Ali Raza']) }),
    ],
    pool: lane([20, 'Bilal Khan'], [21, 'عائشہ خان'], [22, "Zara O'Brien-Khan"]),
    ...overrides,
  };
}

/** The projector's view of the same moment. */
export function display(overrides: Partial<DisplaySnapshot> = {}): DisplaySnapshot {
  return {
    induction_name: 'Fall 2026',
    target_interview_minutes: 15,
    server_time: '2026-09-26T10:00:00Z',
    panels: [
      { id: 'p1', name: 'Panel 1', current: { number: 7, name: 'Sara Ahmed', started_at: '2026-09-26T09:50:00Z' }, lined_up: [] },
      { id: 'p2', name: 'Panel 2', current: null, lined_up: [{ number: 12, name: 'Ali Raza' }] },
    ],
    waiting: [
      { number: 20, name: 'Bilal Khan' },
      { number: 21, name: 'عائشہ خان' },
      { number: 22, name: "Zara O'Brien-Khan" },
    ],
    ...overrides,
  };
}

export function profile(role: Role, overrides: Partial<Profile> = {}): Profile {
  const username = role === 'queue_manager' ? 'queue' : role;
  return { id: `u-${username}`, username, display_name: `Test ${username}`, role, is_active: true, current_panel_id: null, ...overrides };
}

/** #7 Sara Ahmed's application. The LogiKal section is all blank and Marketing is missing, so both tabs hide. */
export function candidateRow(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 'c7',
    number: 7,
    reg_number: '2025007',
    full_name: 'Sara Ahmed',
    email: 'sara@example.test',
    account_email: 'sara.account@example.test',
    phone: '03001234507',
    department: 'Computer Science',
    batch: 'B35',
    submitted_at: '2026-09-20T05:15:02+00:00',
    preferences: ['Dev Team', 'Marketing', '', ''],
    answers: {
      general: [
        { q: 'What motivated you to join Microsoft Club?', a: 'I like building things with others.' },
        { q: 'Tell us about something that you are proud of.', a: '' },
      ],
      dev: [{ q: 'Which programming languages or frameworks do you know?', a: 'TypeScript, Python' }],
      logikal: [{ q: 'Which parts of LogiKal interest you most?', a: '  ' }],
      lnd: [{ q: 'What excites you most about the L&D team?', a: 'Teaching first-years.' }],
    },
    status: 'interviewing',
    checked_in_at: '2026-09-26T09:00:00Z',
    decision: 'undecided',
    ...overrides,
  };
}

/** The seeded placeholder criteria (supabase/migrations/…core_schema.sql). */
export function criteriaList(): Criterion[] {
  const general = ['Communication', 'Confidence & Attitude', 'Teamwork', 'Commitment', 'Problem Solving'];
  const keys = ['communication', 'confidence_attitude', 'teamwork', 'commitment', 'problem_solving'];
  const fit = [['fit_dev', 'Dev'], ['fit_logikal', 'LogiKal'], ['fit_lnd', 'L&D'], ['fit_marketing', 'Marketing']];
  return [
    ...general.map((label, i) => ({ key: keys[i], label, category: 'general' as const, sort_order: i + 1 })),
    ...fit.map(([key, label], i) => ({ key, label, category: 'team_fit' as const, sort_order: i + 6 })),
  ];
}

export function resultRow(overrides: Partial<ResultRow> = {}): ResultRow {
  return {
    candidate_id: 'c7',
    number: 7,
    reg_number: '2025007',
    full_name: 'Sara Ahmed',
    department: 'Computer Science',
    batch: 'B35',
    preferences: ['Dev Team', 'Marketing', '', ''],
    status: 'interviewed',
    decision: 'undecided',
    evaluation_count: 2,
    general_avg: 3.75,
    criteria_avgs: { communication: 4, teamwork: 3.5, fit_dev: 5 },
    recommendations: { yes: 1, strong_yes: 1 },
    ...overrides,
  };
}

export function candidateRecordFor(candidate: Candidate = candidateRow()): CandidateRecord {
  return {
    candidate: { ...candidate, created_at: '2026-09-20T05:20:00Z', updated_at: '2026-09-26T10:20:00Z' },
    interviews: [
      {
        id: 'i7',
        panel_name: 'Panel 1',
        status: 'ended',
        started_at: '2026-09-26T09:50:00Z',
        ended_at: '2026-09-26T10:06:30Z',
        messages: [
          { id: 'm1', interview_id: 'i7', author_id: 'u1', author_name: 'Hamza', body: 'Strong on teamwork.', created_at: '2026-09-26T09:55:00Z' },
        ],
        evaluations: [
          { panelist_name: 'Hamza', scores: { communication: 4, fit_dev: 5 }, recommendation: 'strong_yes', comments: 'Great fit.', submitted_at: '2026-09-26T10:07:00Z', updated_at: '2026-09-26T10:07:00Z' },
          { panelist_name: 'Mariam', scores: { teamwork: 3.5 }, recommendation: 'yes', comments: '', submitted_at: '2026-09-26T10:08:00Z', updated_at: '2026-09-26T10:08:00Z' },
        ],
      },
    ],
  };
}
```

Replace `tests/unit/web/helpers.tsx` with:

```tsx
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { AppProviders } from '../../../src/app/AppProviders.tsx';
import { routes } from '../../../src/app/routes.tsx';
import type { AuthBackend } from '../../../src/auth/authBackend.ts';
import type { Api } from '../../../src/lib/api.ts';
import type { ChannelStatus, Subscribe } from '../../../src/lib/realtime.ts';
import type { Profile } from '../../../src/lib/types.ts';
import { board, candidateRecordFor, candidateRow, criteriaList, display } from './fixtures.ts';

/** A realtime topic the test drives by hand. */
export function fakeTopic() {
  const listeners = new Set<Parameters<Subscribe>[0]>();
  const subscribe: Subscribe = (handlers) => {
    listeners.add(handlers);
    return () => listeners.delete(handlers);
  };
  return {
    subscribe,
    event: () => listeners.forEach((l) => l.onEvent()),
    status: (status: ChannelStatus) => listeners.forEach((l) => l.onStatus(status)),
    get listening() {
      return listeners.size;
    },
  };
}

export type FakeApi = Api & {
  topics: { board: ReturnType<typeof fakeTopic>; display: ReturnType<typeof fakeTopic>; interview: ReturnType<typeof fakeTopic> };
};

/** Every Api method as a vi.fn with a sensible default; override any of them. */
export function fakeApi(overrides: Partial<Api> = {}): FakeApi {
  const topics = { board: fakeTopic(), display: fakeTopic(), interview: fakeTopic() };
  const api: Api = {
    boardSnapshot: vi.fn(async () => board()),
    displaySnapshot: vi.fn(async () => display()),
    serverNow: vi.fn(async () => new Date().toISOString()),
    listCandidates: vi.fn(async () => []),
    getDisplayKey: vi.fn(async () => 'test-key'),
    checkIn: vi.fn(async () => {}),
    undoCheckIn: vi.fn(async () => {}),
    moveCandidate: vi.fn(async () => {}),
    skipCandidate: vi.fn(async () => {}),
    sendIn: vi.fn(async () => 'i-new'),
    undoSendIn: vi.fn(async () => {}),
    endInterview: vi.fn(async () => {}),
    reopenInterview: vi.fn(async () => {}),
    addPanel: vi.fn(async () => 'p-new'),
    deletePanel: vi.fn(async () => {}),
    importCandidates: vi.fn(async () => ({ added: 0, updated: 0, flagged: [] })),
    subscribeBoard: vi.fn(() => topics.board.subscribe),
    subscribeDisplay: vi.fn(() => topics.display.subscribe),
    setMyPanel: vi.fn(async () => {}),
    candidate: vi.fn(async (id: string) => candidateRow({ id })),
    panelInterviews: vi.fn(async () => []),
    criteria: vi.fn(async () => criteriaList()),
    interviewMessages: vi.fn(async () => []),
    postMessage: vi.fn(async (interviewId: string, body: string, id: string) => ({
      id,
      interview_id: interviewId,
      author_id: 'u-panelist',
      author_name: 'Test panelist',
      body,
      created_at: new Date().toISOString(),
    })),
    evaluationCount: vi.fn(async () => 0),
    myEvaluations: vi.fn(async () => []),
    submitEvaluation: vi.fn(async () => {}),
    subscribeInterview: vi.fn(() => topics.interview.subscribe),
    listAccounts: vi.fn(async () => []),
    manageAccount: vi.fn(async () => {}),
    induction: vi.fn(async () => ({ id: 'ind-1', name: 'Fall 2026', target_interview_minutes: 15, results_published: false })),
    updateSettings: vi.fn(async () => {}),
    regenerateDisplayKey: vi.fn(async () => 'new-key'),
    resultsTable: vi.fn(async () => []),
    candidateRecord: vi.fn(async () => candidateRecordFor()),
    evaluationsExport: vi.fn(async () => []),
    setDecision: vi.fn(async () => {}),
    setResultsPublished: vi.fn(async () => {}),
    publishedResults: vi.fn(async () => []),
    ...overrides,
  };
  return Object.assign(api, { topics });
}

/** An in-memory Supabase Auth: `accounts` can sign in; `signedInAs` starts with a session. */
export function fakeAuth(options: { signedInAs?: Profile; accounts?: Record<string, { password: string; profile: Profile }> } = {}) {
  let userId: string | null = options.signedInAs?.id ?? null;
  const profiles = new Map<string, Profile>();
  if (options.signedInAs) profiles.set(options.signedInAs.id, options.signedInAs);
  for (const account of Object.values(options.accounts ?? {})) profiles.set(account.profile.id, account.profile);
  const listeners = new Set<(id: string | null) => void>();
  const backend: AuthBackend = {
    currentUserId: async () => userId,
    onUserChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    signIn: async (username, password) => {
      const account = options.accounts?.[username];
      if (!account || account.password !== password) return 'Wrong username or password.';
      userId = account.profile.id;
      listeners.forEach((l) => l(userId));
      return null;
    },
    signOut: vi.fn(async () => {
      userId = null;
      listeners.forEach((l) => l(null));
    }),
    loadProfile: async (id) => profiles.get(id) ?? null,
  };
  return { backend, profiles };
}

/** Renders the real routes at `path` with fake Supabase pieces. */
export function renderApp(path: string, { api = fakeApi(), auth = fakeAuth().backend }: { api?: Api; auth?: AuthBackend } = {}) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <AppProviders api={api} auth={auth}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...view, router, api };
}
```

- [ ] **Step 5: Run the unit tests and the type check**

Run: `npm run test:unit && npm run typecheck`
Expected:
- `Tests  110 passed (110)`
- `tsc` prints nothing.

- [ ] **Step 6: Write the integration test against the real stack**

`tests/integration/web-panel-admin.test.ts`:

```ts
// The Plan 3 API calls against the real local stack: panelist chat and evaluations, results,
// decisions, publishing, settings and account management (needs `npm run functions:serve`).
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError, createApi, NOT_ALLOWED, type Api } from '../../src/lib/api.ts';
import type { ChannelStatus, Subscribe } from '../../src/lib/realtime.ts';
import { env, makeAccount, service, signIn, TEST_PASSWORD, uniqueName, waitFor } from './support.ts';

const sortedKeys = (value: object | null | undefined) => Object.keys(value ?? {}).sort();

async function expectEvent(subscribe: Subscribe, poke: () => Promise<unknown>): Promise<void> {
  const statuses: ChannelStatus[] = [];
  let events = 0;
  const stop = subscribe({ onEvent: () => events++, onStatus: (status) => statuses.push(status) });
  try {
    await waitFor(() => statuses.includes('subscribed'), 15_000);
    const deadline = Date.now() + 20_000;
    while (events === 0) {
      if (Date.now() > deadline) throw new Error(`No realtime event (statuses: ${statuses.join(', ')})`);
      await poke();
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } finally {
    stop();
  }
}

describe('panelist, admin and results API', () => {
  const accountIds: string[] = [];
  const names = { qm: uniqueName('p3_qm'), a: uniqueName('p3_pa'), b: uniqueName('p3_pb'), admin: uniqueName('p3_ad') };
  const ids: Record<string, string> = {};
  let qm: Api;
  let panelistA: Api;
  let panelistB: Api;
  let admin: Api;
  let anon: Api;
  let inductionId: string;
  let panelId: string | undefined;
  let interviewId: string | undefined;
  let candidateId: string;
  let reg: string;
  let original: { name: string; target_interview_minutes: number };

  beforeAll(async () => {
    ids.qm = await makeAccount(names.qm, 'queue_manager');
    ids.a = await makeAccount(names.a, 'panelist');
    ids.b = await makeAccount(names.b, 'panelist');
    ids.admin = await makeAccount(names.admin, 'admin');
    accountIds.push(ids.qm, ids.a, ids.b, ids.admin);
    [qm, panelistA, panelistB, admin] = (await Promise.all([signIn(names.qm), signIn(names.a), signIn(names.b), signIn(names.admin)])).map(createApi);
    anon = createApi(createClient(env.url, env.anonKey, { auth: { persistSession: false } }));
    inductionId = (await qm.boardSnapshot()).induction.id;
    original = await admin.induction();

    // One candidate, sent into a panel of their own.
    panelId = await qm.addPanel();
    reg = `P3${Date.now()}`;
    await qm.importCandidates([{
      submitted_at: new Date().toISOString(), reg_number: reg, full_name: 'Plan Three Tester', email: '', account_email: '',
      phone: '03000000000', department: 'Computer Science', batch: 'B35', preferences: ['Dev Team', '', '', ''],
      answers: { general: [{ q: 'Why MLSA?', a: 'To learn.' }], dev: [], logikal: [], lnd: [], marketing: [] },
    }]);
    candidateId = (await qm.listCandidates(inductionId)).find((c) => c.reg_number === reg)!.id;
    await qm.checkIn(candidateId);
    interviewId = await qm.sendIn(candidateId, panelId);
  });

  afterAll(async () => {
    await admin.setResultsPublished(false).catch(() => undefined);
    await admin.setDecision(candidateId, 'undecided').catch(() => undefined);
    await admin.updateSettings(original.name, original.target_interview_minutes).catch(() => undefined);
    if (interviewId) await qm.endInterview(interviewId).catch(() => undefined);
    if (panelId) await qm.deletePanel(panelId).catch(() => undefined);
    for (const id of accountIds) await service.auth.admin.deleteUser(id);
  });

  it('lets panelists join a panel, read the application, chat and evaluate', async () => {
    await panelistA.setMyPanel(panelId!);
    const board = await panelistA.boardSnapshot();
    expect(board.panels.find((p) => p.id === panelId)?.panelists.map((p) => p.id)).toContain(ids.a);

    const candidate = await panelistA.candidate(candidateId);
    expect(sortedKeys(candidate)).toEqual([
      'account_email', 'answers', 'batch', 'checked_in_at', 'decision', 'department', 'email', 'full_name', 'id',
      'number', 'phone', 'preferences', 'reg_number', 'status', 'submitted_at',
    ]);
    expect(candidate.answers.general?.[0]).toEqual({ q: 'Why MLSA?', a: 'To learn.' });
    await expect(panelistA.candidate('00000000-0000-0000-0000-000000000000')).rejects.toEqual(new ApiError('Candidate not found'));

    const [interview] = await panelistA.panelInterviews(panelId!);
    expect(sortedKeys(interview)).toEqual(['candidate', 'ended_at', 'id', 'started_at', 'status']);
    expect(interview).toMatchObject({ id: interviewId, status: 'in_progress', candidate: { id: candidateId, full_name: 'Plan Three Tester' } });

    const criteria = await panelistA.criteria(inductionId);
    expect(criteria.map((c) => c.key)).toEqual([
      'communication', 'confidence_attitude', 'teamwork', 'commitment', 'problem_solving', 'fit_dev', 'fit_logikal', 'fit_lnd', 'fit_marketing',
    ]);
    expect(sortedKeys(criteria[0])).toEqual(['category', 'key', 'label', 'sort_order']);

    const id = crypto.randomUUID();
    const message = await panelistA.postMessage(interviewId!, 'Strong answers on teamwork', id);
    expect(sortedKeys(message)).toEqual(['author_id', 'author_name', 'body', 'created_at', 'id', 'interview_id']);
    expect(await panelistA.postMessage(interviewId!, 'Strong answers on teamwork', id)).toEqual(message); // a retry doesn't post twice
    expect((await panelistB.interviewMessages(interviewId!)).map((m) => m.body)).toEqual(['Strong answers on teamwork']);

    expect(await panelistB.evaluationCount(interviewId!)).toBe(0);
    await panelistA.submitEvaluation(interviewId!, { communication: 4, teamwork: 5, fit_dev: 5 }, 'strong_yes', 'Great fit');
    expect(await panelistB.evaluationCount(interviewId!)).toBe(1);
    const [mine] = await panelistA.myEvaluations(ids.a);
    expect(sortedKeys(mine)).toEqual(['comments', 'interview_id', 'recommendation', 'scores', 'updated_at']);
    expect(mine).toMatchObject({ interview_id: interviewId, recommendation: 'strong_yes', scores: { communication: 4, teamwork: 5, fit_dev: 5 } });
    expect(await panelistB.myEvaluations(ids.b)).toEqual([]);
    expect(await qm.interviewMessages(interviewId!).catch((e: Error) => e.message)).toBe(NOT_ALLOWED);

    await expectEvent(panelistB.subscribeInterview(interviewId!), () => panelistA.postMessage(interviewId!, 'ping', crypto.randomUUID()));
  });

  it('gives admins the results, the full record and the exports, and publishes the selected list', async () => {
    await qm.endInterview(interviewId!);
    const row = (await admin.resultsTable()).find((r) => r.candidate_id === candidateId)!;
    expect(sortedKeys(row)).toEqual([
      'batch', 'candidate_id', 'criteria_avgs', 'decision', 'department', 'evaluation_count', 'full_name', 'general_avg',
      'number', 'preferences', 'recommendations', 'reg_number', 'status',
    ]);
    expect(row).toMatchObject({ evaluation_count: 1, general_avg: 4.5, recommendations: { strong_yes: 1 }, criteria_avgs: { fit_dev: 5 } });

    const record = await admin.candidateRecord(candidateId);
    expect(sortedKeys(record)).toEqual(['candidate', 'interviews']);
    expect(sortedKeys(record.interviews[0])).toEqual(['ended_at', 'evaluations', 'id', 'messages', 'panel_name', 'started_at', 'status']);
    expect(sortedKeys(record.interviews[0].evaluations[0])).toEqual(['comments', 'panelist_name', 'recommendation', 'scores', 'submitted_at', 'updated_at']);
    const bodies = record.interviews[0].messages.map((m) => m.body);
    expect(bodies[0]).toBe('Strong answers on teamwork');
    expect(bodies.slice(1).every((body) => body === 'ping')).toBe(true); // expectEvent pokes until an event arrives

    const exported = (await admin.evaluationsExport()).filter((e) => e.reg_number === reg);
    expect(exported).toHaveLength(1);
    expect(sortedKeys(exported[0])).toEqual(['comments', 'full_name', 'number', 'panel', 'panelist', 'recommendation', 'reg_number', 'scores', 'submitted_at']);

    await admin.setDecision(candidateId, 'selected');
    expect(await anon.publishedResults()).not.toContainEqual({ full_name: 'Plan Three Tester', reg_number: reg });
    await admin.setResultsPublished(true);
    expect((await admin.induction()).results_published).toBe(true);
    expect(await anon.publishedResults()).toContainEqual({ full_name: 'Plan Three Tester', reg_number: reg });
    await expect(panelistA.submitEvaluation(interviewId!, {}, 'no', '')).rejects.toEqual(
      new ApiError('Results are published; evaluations are locked'),
    );
    await admin.setResultsPublished(false);
    interviewId = undefined;
  });

  it('manages accounts through the edge function, for admins only', async () => {
    const username = uniqueName('p3_new');
    await admin.manageAccount({ action: 'create', username, displayName: 'New Panelist', role: 'panelist', password: TEST_PASSWORD });
    const created = (await admin.listAccounts()).find((a) => a.username === username)!;
    accountIds.push(created.id);
    expect(sortedKeys(created)).toEqual(['current_panel_id', 'display_name', 'id', 'is_active', 'role', 'username']);
    await expect(
      admin.manageAccount({ action: 'create', username, displayName: 'Again', role: 'panelist', password: TEST_PASSWORD }),
    ).rejects.toEqual(new ApiError('Username already taken'));

    await admin.manageAccount({ action: 'reset_password', userId: created.id, password: 'a-new-password' });
    await expect(signIn(username, 'a-new-password')).resolves.toBeTruthy();
    await admin.manageAccount({ action: 'set_active', userId: created.id, active: false });
    await expect(signIn(username, 'a-new-password')).rejects.toThrow();
    expect((await admin.listAccounts()).find((a) => a.id === created.id)?.is_active).toBe(false);
    await admin.manageAccount({ action: 'set_active', userId: created.id, active: true });

    await expect(qm.manageAccount({ action: 'set_active', userId: created.id, active: false })).rejects.toEqual(new ApiError(NOT_ALLOWED));
  });

  it('changes settings and the projector key', async () => {
    await admin.updateSettings('Fall 2026 (test)', 20);
    expect(await admin.induction()).toMatchObject({ name: 'Fall 2026 (test)', target_interview_minutes: 20 });
    const oldKey = await admin.getDisplayKey();
    const newKey = await admin.regenerateDisplayKey();
    expect(newKey).not.toBe(oldKey);
    expect(await anon.displaySnapshot(oldKey)).toBeNull();
    expect((await anon.displaySnapshot(newKey))?.induction_name).toBe('Fall 2026 (test)');
  });
});
```

- [ ] **Step 7: Run it**

With `npm run functions:serve` running in a second terminal:

Run: `npm run test:integration`
Expected: `Tests  18 passed (18)` (14 from Plans 1 and 2, plus 4).

- [ ] **Step 8: Commit**

```bash
git add src/lib/types.ts src/lib/api.ts tests/unit/web/api.test.ts tests/unit/web/fixtures.ts tests/unit/web/helpers.tsx tests/integration/web-panel-admin.test.ts
git commit -m "feat(web): API calls for the panelist screen, admin and results"
```

---

### Task 3: Rejoin closed channels, recover from render errors, plain login after sign-out

**Files:**
- Create: `src/app/RouteError.tsx`
- Modify: `src/lib/realtime.ts`, `src/app/routes.tsx`, `src/app/StaffLayout.tsx`, `tests/unit/web/routing.test.tsx`
- Test: `tests/unit/web/realtime.test.ts`, `tests/unit/web/routeError.test.tsx`, `tests/unit/web/routing.test.tsx`

**Interfaces:**
- Consumes: `broadcastSubscriber` and `Subscribe` (Plan 2), `FullPageMessage`, `buttonClasses`, `useAuth`.
- Produces:
  - `broadcastSubscriber(client, topic, isPrivate)` behaves as before, plus: after the server closes a channel (`CLOSED`) it reports `'closed'` and joins a fresh channel after 1 s, 2 s, 5 s and then every 10 s. A successful join resets the wait.
  - `RouteError`, the `errorElement` of every top-level route:
    - on `/display…` it shows the projector's "Connecting…" screen (`data-testid="projector-recovering"`) and reloads after 10 s;
    - elsewhere it shows "Something went wrong" with **Reload the page**.
  - `StaffLayout` sends a deliberate sign-out to a plain `/login`, and an expired session still to `/login?next=…`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/web/realtime.test.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { broadcastSubscriber, type ChannelStatus } from '../../../src/lib/realtime.ts';

/** Stands in for a realtime-js channel: the test drives its status callback and events. */
class FakeChannel {
  private statusCallback?: (status: string) => void;
  private listeners: Array<() => void> = [];
  constructor(readonly topic: string, readonly options: unknown) {}
  on(_type: string, _filter: unknown, listener: () => void) {
    this.listeners.push(listener);
    return this;
  }
  subscribe(callback: (status: string) => void) {
    this.statusCallback = callback;
    return this;
  }
  status(status: string) {
    this.statusCallback?.(status);
  }
  event() {
    this.listeners.forEach((listener) => listener());
  }
}

function fakeClient() {
  const channels: FakeChannel[] = [];
  const calls: string[] = [];
  const client = {
    realtime: { setAuth: vi.fn(async () => calls.push('setAuth')) },
    channel: vi.fn((topic: string, options: unknown) => {
      calls.push(`channel ${topic}`);
      const channel = new FakeChannel(topic, options);
      channels.push(channel);
      return channel;
    }),
    removeChannel: vi.fn(async () => 'ok'),
  };
  return { client: client as unknown as SupabaseClient, raw: client, channels, calls };
}

function listen(client: SupabaseClient, topic: string, isPrivate: boolean) {
  const statuses: ChannelStatus[] = [];
  const onEvent = vi.fn();
  const stop = broadcastSubscriber(client, topic, isPrivate)({ onEvent, onStatus: (s) => statuses.push(s) });
  return { statuses, onEvent, stop };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('broadcastSubscriber', () => {
  afterEach(() => vi.useRealTimers());

  it('joins on the next tick and reports statuses and events', async () => {
    const { client, channels } = fakeClient();
    const { statuses, onEvent } = listen(client, 'display:k1', false);
    expect(channels).toHaveLength(0); // deferred, so a StrictMode remount never abandons a channel
    await tick();
    expect(channels.map((c) => [c.topic, c.options])).toEqual([['display:k1', { config: { private: false } }]]);

    channels[0].status('SUBSCRIBED');
    channels[0].event();
    channels[0].status('CHANNEL_ERROR');
    channels[0].status('TIMED_OUT');
    expect(statuses).toEqual(['subscribed', 'error', 'error']);
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it('passes the signed-in token to realtime before joining a private channel', async () => {
    const { client, calls } = fakeClient();
    listen(client, 'board', true);
    await tick();
    expect(calls).toEqual(['setAuth', 'channel board']);
  });

  it('creates no channel when stopped before joining', async () => {
    const { client, channels } = fakeClient();
    listen(client, 'board', true).stop();
    await tick();
    expect(channels).toHaveLength(0);
  });

  it('leaves when stopped and ignores the channel afterwards', async () => {
    const { client, raw, channels } = fakeClient();
    const { statuses, onEvent, stop } = listen(client, 'board', true);
    await tick();
    stop();
    expect(raw.removeChannel).toHaveBeenCalledWith(channels[0]);
    channels[0].status('CLOSED');
    channels[0].event();
    expect(statuses).toEqual([]);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('starts a new channel when the server closes this one, backing off between tries', async () => {
    vi.useFakeTimers();
    const { client, channels } = fakeClient();
    const { statuses, stop } = listen(client, 'board', true);
    await vi.advanceTimersByTimeAsync(0);
    channels[0].status('SUBSCRIBED');

    channels[0].status('CLOSED'); // e.g. the server ended the channel; realtime-js won't rejoin it
    expect(statuses).toEqual(['subscribed', 'closed']);
    await vi.advanceTimersByTimeAsync(999);
    expect(channels).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(channels).toHaveLength(2);

    channels[1].status('CLOSED');
    await vi.advanceTimersByTimeAsync(1999);
    expect(channels).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(channels).toHaveLength(3);
    channels[2].status('SUBSCRIBED');
    expect(statuses.at(-1)).toBe('subscribed');

    channels[2].status('CLOSED');
    stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(channels).toHaveLength(3); // no rejoin after stop
  });
});
```

`tests/unit/web/routeError.test.tsx`:

```tsx
// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardSnapshot, DisplaySnapshot } from '../../../src/lib/types.ts';
import { board, display, profile } from './fixtures.ts';
import { fakeApi, fakeAuth, renderApp } from './helpers.tsx';

describe('when a screen fails to render', () => {
  afterEach(() => vi.restoreAllMocks());

  it('the projector shows "Connecting…" and tries again, never an error page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = { ...display(), panels: null } as unknown as DisplaySnapshot; // a bug or unexpected data
    renderApp('/display?key=k1', { api: fakeApi({ displaySnapshot: vi.fn(async () => broken) }) });
    expect(await screen.findByTestId('projector-recovering')).toHaveTextContent('Connecting…');
    expect(screen.queryByText(/Unexpected Application Error/)).toBeNull();
  });

  it('staff screens say so and offer a reload', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = { ...board(), panels: null } as unknown as BoardSnapshot;
    renderApp('/queue', {
      api: fakeApi({ boardSnapshot: vi.fn(async () => broken) }),
      auth: fakeAuth({ signedInAs: profile('queue_manager') }).backend,
    });
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeInTheDocument();
    expect(screen.queryByText(/Unexpected Application Error/)).toBeNull();
  });
});
```

Replace `tests/unit/web/routing.test.tsx` with this version (the sign-out test now checks the query string):

```tsx
// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { profile } from './fixtures.ts';
import { fakeAuth, renderApp } from './helpers.tsx';

const accounts = {
  queue: { password: 'right-password', profile: profile('queue_manager') },
  panelist: { password: 'right-password', profile: profile('panelist') },
};

async function signIn(username: string, password = 'right-password') {
  await userEvent.type(await screen.findByLabelText('Username'), username);
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('sign in and routing', () => {
  it('sends a signed-out visitor to the login page and back after signing in', async () => {
    const { router } = renderApp('/queue', { auth: fakeAuth({ accounts }).backend });
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe('?next=%2Fqueue');

    await signIn('queue');
    await waitFor(() => expect(router.state.location.pathname).toBe('/queue'));
  });

  it('shows why a sign-in failed', async () => {
    renderApp('/login', { auth: fakeAuth({ accounts }).backend });
    await signIn('queue', 'wrong-password');
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username or password.');
  });

  it("sends each role to its own screen and ignores off-site ?next= targets", async () => {
    const { router } = renderApp('/login?next=//evil.example', { auth: fakeAuth({ accounts }).backend });
    await signIn('panelist');
    await waitFor(() => expect(router.state.location.pathname).toBe('/panel'));
  });

  it("keeps a role out of another role's screen", async () => {
    renderApp('/queue', { auth: fakeAuth({ signedInAs: profile('panelist') }).backend });
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
  });

  it('lets an admin open every screen and sign out', async () => {
    const { router } = renderApp('/', { auth: fakeAuth({ signedInAs: profile('admin') }).backend });
    await waitFor(() => expect(router.state.location.pathname).toBe('/admin'));
    const nav = screen.getByRole('navigation', { name: 'Screens' });
    expect(nav).toHaveTextContent('QueuePanelAdmin');
    expect(await screen.findByText('http://localhost:3000/display?key=test-key')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe(''); // the next person to sign in starts on their own screen
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/unit/web/realtime.test.ts tests/unit/web/routeError.test.tsx tests/unit/web/routing.test.tsx`
Expected:
FAIL: 4 tests fail, and the other 8 pass.
- `realtime.test.ts` › "starts a new channel when the server closes this one…": `expected [ FakeChannel{ topic: 'board', … } ] to have a length of 2 but got 1`.
- `routeError.test.tsx`, both tests: `Unable to find an element by: [data-testid="projector-recovering"]` and `Unable to find an element with the text: Something went wrong`. React Router's own error page shows instead.
- `routing.test.tsx` › "lets an admin open every screen and sign out": `expected '?next=%2Fadmin' to be ''`.

- [ ] **Step 3: Rejoin closed channels**

Replace `src/lib/realtime.ts` with:

```ts
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

export type ChannelStatus = 'subscribed' | 'error' | 'closed';

/**
 * Starts listening to one realtime topic and returns a function that stops. Screens treat every
 * event as "reload your snapshot" and every (re)subscription as "reload, you may have missed events".
 */
export type Subscribe = (handlers: { onEvent: () => void; onStatus: (status: ChannelStatus) => void }) => () => void;

/** Waits between attempts to rejoin a channel the server closed: 1 s, 2 s, 5 s, then every 10 s. */
const REJOIN_DELAYS_MS = [1000, 2000, 5000, 10_000];

export function broadcastSubscriber(client: SupabaseClient, topic: string, isPrivate: boolean): Subscribe {
  return ({ onEvent, onStatus }) => {
    let stopped = false;
    let channel: RealtimeChannel | null = null;
    let attempt = 0;
    let rejoinTimer: ReturnType<typeof setTimeout> | undefined;

    const join = async () => {
      if (isPrivate) {
        try {
          await client.realtime.setAuth(); // private channels need the signed-in user's token
        } catch {
          // The join below then fails and reports CHANNEL_ERROR, which the screen shows.
        }
      }
      // Deferred, so React StrictMode's mount → unmount → mount never creates a channel it abandons.
      await Promise.resolve();
      if (stopped) return;
      const current = client.channel(topic, { config: { private: isPrivate } }).on('broadcast', { event: '*' }, () => {
        if (!stopped && channel === current) onEvent();
      });
      channel = current;
      current.subscribe((status) => {
        if (stopped || channel !== current) return;
        if (status === 'SUBSCRIBED') {
          attempt = 0;
          onStatus('subscribed');
        } else if (status === 'CLOSED') {
          // The server ended this channel. realtime-js rejoins after errors and dropped sockets, but
          // not after a close, so start a fresh channel (it has already left the client's list).
          onStatus('closed');
          channel = null;
          const delay = REJOIN_DELAYS_MS[Math.min(attempt++, REJOIN_DELAYS_MS.length - 1)];
          rejoinTimer = setTimeout(() => void join(), delay);
        } else {
          onStatus('error');
        }
      });
    };

    void join();
    return () => {
      stopped = true;
      clearTimeout(rejoinTimer);
      if (channel) void client.removeChannel(channel);
    };
  };
}
```

- [ ] **Step 4: Add the route error screen**

`src/app/RouteError.tsx`:

```tsx
import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { buttonClasses } from '../components/ActionButton.tsx';
import { FullPageMessage } from '../components/FullPageMessage.tsx';

const PROJECTOR_RETRY_MS = 10_000;

/** Shown instead of React Router's error page when a screen crashes while rendering. */
export function RouteError() {
  const { pathname } = useLocation();
  if (pathname.startsWith('/display')) return <ProjectorRecovery />;
  return (
    <FullPageMessage title="Something went wrong">
      <p>This screen hit an unexpected problem. Reloading usually fixes it.</p>
      <button type="button" className={`${buttonClasses('primary', 'md')} mt-3`} onClick={() => window.location.reload()}>
        Reload the page
      </button>
    </FullPageMessage>
  );
}

/** The projector never shows an error page (spec §11): it looks like it is connecting and reloads itself. */
function ProjectorRecovery() {
  useEffect(() => {
    const timer = setTimeout(() => window.location.reload(), PROJECTOR_RETRY_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div data-testid="projector-recovering" className="flex h-screen items-center justify-center bg-slate-950 text-[3vw] text-slate-500">
      Connecting…
    </div>
  );
}
```

Replace `src/app/routes.tsx` with:

```tsx
import type { RouteObject } from 'react-router';
import { DisplayPage } from '../display/DisplayPage.tsx';
import { QueuePage } from '../queue/QueuePage.tsx';
import { LoginPage } from './LoginPage.tsx';
import { AdminHome, ComingSoon, HomeRedirect, NotFound } from './placeholders.tsx';
import { RequireRole } from './RequireRole.tsx';
import { RouteError } from './RouteError.tsx';
import { StaffLayout } from './StaffLayout.tsx';

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  { path: '/display', element: <DisplayPage />, errorElement: <RouteError /> },
  {
    path: '/',
    element: <StaffLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'queue', element: <RequireRole roles={['queue_manager', 'admin']}><QueuePage /></RequireRole> },
      { path: 'panel', element: <RequireRole roles={['panelist', 'admin']}><ComingSoon title="Panelist screen" /></RequireRole> },
      { path: 'admin', element: <RequireRole roles={['admin']}><AdminHome /></RequireRole> },
    ],
  },
  { path: '*', element: <NotFound />, errorElement: <RouteError /> },
];
```

- [ ] **Step 5: Plain login after a deliberate sign-out**

Replace `src/app/StaffLayout.tsx` with:

```tsx
import { useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthProvider.tsx';
import { buttonClasses } from '../components/ActionButton.tsx';
import { FullPageMessage } from '../components/FullPageMessage.tsx';
import type { Role } from '../lib/types.ts';
import { ROLE_LABELS } from './homePath.ts';

const NAV: Array<{ to: string; label: string; roles: Role[] }> = [
  { to: '/queue', label: 'Queue', roles: ['queue_manager', 'admin'] },
  { to: '/panel', label: 'Panel', roles: ['panelist', 'admin'] },
  { to: '/admin', label: 'Admin', roles: ['admin'] },
];

/** Every signed-in screen: requires a login, shows who is signed in, and links the screens this role can open. */
export function StaffLayout() {
  const { state, signOut } = useAuth();
  const location = useLocation();
  // After "Sign out" the next person to sign in on this laptop should land on their own screen.
  const [signedOutHere, setSignedOutHere] = useState(false);

  if (state.status === 'loading') return <FullPageMessage title="Loading…" />;
  if (state.status === 'signed_out') {
    const next = signedOutHere ? '' : `?next=${encodeURIComponent(location.pathname + location.search)}`;
    return <Navigate to={`/login${next}`} replace />;
  }

  const { profile } = state;
  const links = NAV.filter((link) => link.roles.includes(profile.role));
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex h-12 items-center gap-4 border-b border-slate-200 bg-white px-4">
        <span className="font-semibold">MLSA Induction</span>
        {links.length > 1 && (
          <nav aria-label="Screens" className="flex gap-1">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `rounded-md px-2.5 py-1 text-sm font-medium ${isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'}`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        )}
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="hidden text-slate-600 sm:inline">
            {profile.display_name} · {ROLE_LABELS[profile.role]}
          </span>
          <button
            type="button"
            onClick={() => {
              setSignedOutHere(true);
              void signOut();
            }}
            className={buttonClasses('ghost')}
          >
            Sign out
          </button>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
```

- [ ] **Step 6: Run the tests and the type check**

Run: `npm run test:unit && npm run typecheck`
Expected:
- `Tests  117 passed (117)`
- `tsc` prints nothing.

- [ ] **Step 7: Commit**

```bash
git add src/lib/realtime.ts src/app/RouteError.tsx src/app/routes.tsx src/app/StaffLayout.tsx tests/unit/web/realtime.test.ts tests/unit/web/routeError.test.tsx tests/unit/web/routing.test.tsx
git commit -m "fix(web): rejoin closed channels, recover from render errors, plain login after sign-out"
```

---

### Task 4: The candidate card and application tabs

**Files:**
- Create: `src/panel/applicationView.ts`, `src/panel/ApplicationTabs.tsx`, `src/panel/CandidateCard.tsx`
- Test: `tests/unit/web/application.test.tsx`

**Interfaces:**
- Consumes: `Candidate`, `AnswerSection`, `InterviewStatus` (types), `Timer`, `formatElapsed` and `parseServerTime` (Plan 2), `ActionButton`, `api.endInterview`.
- Produces:
  - `SECTION_LABELS: Record<AnswerSection, string>`
  - `visibleSections(candidate): VisibleSection[]`: the sections with at least one non-blank answer, keeping only answered questions.
  - `rankedPreferences(preferences): Array<{ rank, team }>`: skips blank preferences and keeps the candidate's own ranking.
  - `<ApplicationTabs candidate>`:
    - a tablist "Application sections" with one tab per visible section, plus Contact;
    - answers keep line breaks (`whitespace-pre-wrap`) and use `dir="auto"`, so Urdu runs right to left.
  - `<CandidateCard candidate interview? targetMinutes>`:
    - shows the number, name, reg number, department, batch and ranked preferences;
    - while `interview.status === 'in_progress'`, adds a live timer and **End interview**;
    - after an interview ends, shows "Interview ended · mm:ss".
  - `CardInterview` (`{ id, status, started_at, ended_at }`).

- [ ] **Step 1: Write the failing tests**

`tests/unit/web/application.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ActionProvider } from '../../../src/components/ActionProvider.tsx';
import { ToastProvider } from '../../../src/components/Toasts.tsx';
import { ApiProvider } from '../../../src/lib/ApiProvider.tsx';
import { ClockProvider } from '../../../src/lib/ClockProvider.tsx';
import type { Candidate } from '../../../src/lib/types.ts';
import { ApplicationTabs } from '../../../src/panel/ApplicationTabs.tsx';
import { visibleSections } from '../../../src/panel/applicationView.ts';
import { CandidateCard, type CardInterview } from '../../../src/panel/CandidateCard.tsx';
import { candidateRow } from './fixtures.ts';
import { fakeApi } from './helpers.tsx';

function renderApplication(candidate: Candidate = candidateRow(), interview?: CardInterview) {
  const api = fakeApi();
  render(
    <ApiProvider api={api}>
      <ToastProvider>
        <ClockProvider serverNow={api.serverNow}>
          <ActionProvider>
            <CandidateCard candidate={candidate} interview={interview} targetMinutes={15} />
            <ApplicationTabs candidate={candidate} />
          </ActionProvider>
        </ClockProvider>
      </ToastProvider>
    </ApiProvider>,
  );
  return api;
}

describe('visibleSections', () => {
  it('keeps only answered questions, and only sections with an answer', () => {
    const sections = visibleSections(candidateRow());
    expect(sections.map((s) => s.label)).toEqual(['General', 'Dev', 'L&D']);
    expect(sections[0].answers).toEqual([{ q: 'What motivated you to join Microsoft Club?', a: 'I like building things with others.' }]);
  });
});

describe('the application', () => {
  it("shows the candidate's card with ranked preferences", () => {
    renderApplication();
    const card = screen.getByRole('region', { name: 'Candidate #7' });
    expect(within(card).getByRole('heading', { name: '#7 Sara Ahmed' })).toBeInTheDocument();
    expect(card).toHaveTextContent('2025007 · Computer Science · B35');
    expect(within(card).getByRole('list', { name: 'Team preferences' })).toHaveTextContent('1Dev Team2Marketing');
  });

  it('has a tab per answered section plus Contact, and hides blank answers', async () => {
    renderApplication();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['General', 'Dev', 'L&D', 'Contact']);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('I like building things with others.');
    expect(screen.queryByText('Tell us about something that you are proud of.')).toBeNull();

    await userEvent.click(screen.getByRole('tab', { name: 'Contact' }));
    const contact = screen.getByRole('tabpanel');
    expect(contact).toHaveTextContent('sara@example.test');
    expect(contact).toHaveTextContent('sara.account@example.test');
    expect(contact).toHaveTextContent('03001234507');
  });

  it('keeps line breaks and lets Urdu answers run right to left', () => {
    renderApplication(candidateRow({ answers: { general: [{ q: 'Why?', a: 'پہلی لائن\nدوسری لائن' }] } }));
    const answer = screen.getByText((_, el) => el?.tagName === 'DD' && el.textContent === 'پہلی لائن\nدوسری لائن');
    expect(answer).toHaveAttribute('dir', 'auto');
    expect(answer).toHaveClass('whitespace-pre-wrap');
  });

  it('shows the live timer and End interview while the interview runs', async () => {
    const api = renderApplication(candidateRow(), { id: 'i7', status: 'in_progress', started_at: new Date().toISOString(), ended_at: null });
    expect(screen.getByText('00:00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'End interview' }));
    expect(api.endInterview).toHaveBeenCalledWith('i7');
  });

  it('says when an interview has ended, without an End button', () => {
    renderApplication(candidateRow(), { id: 'i7', status: 'ended', started_at: '2026-09-26T09:50:00Z', ended_at: '2026-09-26T10:06:30Z' });
    expect(screen.getByText('Interview ended · 16:30')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End interview' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/unit/web/application.test.tsx`
Expected:
FAIL: `Failed to resolve import "../../../src/panel/ApplicationTabs.tsx" from "tests/unit/web/application.test.tsx". Does the file exist?`

- [ ] **Step 3: Write the view helpers and the components**

`src/panel/applicationView.ts`:

```ts
import type { Answer, AnswerSection, Candidate } from '../lib/types.ts';

export const SECTION_LABELS: Record<AnswerSection, string> = {
  general: 'General',
  dev: 'Dev',
  logikal: 'LogiKal',
  lnd: 'L&D',
  marketing: 'Marketing',
};

const SECTION_ORDER: AnswerSection[] = ['general', 'dev', 'logikal', 'lnd', 'marketing'];

export interface VisibleSection {
  key: AnswerSection;
  label: string;
  answers: Answer[];
}

/** Sections in form order, each with only its answered questions; sections with none are left out. */
export function visibleSections(candidate: Candidate): VisibleSection[] {
  return SECTION_ORDER.map((key) => ({
    key,
    label: SECTION_LABELS[key],
    answers: (candidate.answers[key] ?? []).filter((answer) => answer.a.trim() !== ''),
  })).filter((section) => section.answers.length > 0);
}

/** Team preferences with their rank; blank ranks are skipped but keep their number. */
export function rankedPreferences(preferences: string[]): Array<{ rank: number; team: string }> {
  return preferences.map((team, i) => ({ rank: i + 1, team: team.trim() })).filter((p) => p.team !== '');
}
```

`src/panel/ApplicationTabs.tsx`:

```tsx
import { useState } from 'react';
import type { Candidate } from '../lib/types.ts';
import { visibleSections } from './applicationView.ts';

/** General · Dev · LogiKal · L&D · Marketing · Contact, hiding sections and questions left blank. */
export function ApplicationTabs({ candidate }: { candidate: Candidate }) {
  const sections = visibleSections(candidate);
  const tabs = [...sections.map((s) => ({ key: s.key as string, label: s.label })), { key: 'contact', label: 'Contact' }];
  const [chosen, setChosen] = useState(tabs[0].key);
  const active = tabs.some((t) => t.key === chosen) ? chosen : tabs[0].key;
  const section = sections.find((s) => s.key === active);
  const contact: Array<[string, string]> = [
    ['Email', candidate.email],
    ['Google account', candidate.account_email],
    ['Phone (WhatsApp)', candidate.phone],
    ['Registration number', candidate.reg_number],
    ['Department', candidate.department],
    ['Batch', candidate.batch],
  ];

  return (
    <section aria-label="Application" className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div role="tablist" aria-label="Application sections" className="flex gap-1 overflow-x-auto border-b border-slate-100 px-2 pt-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            id={`application-tab-${tab.key}`}
            aria-selected={tab.key === active}
            aria-controls="application-panel"
            onClick={() => setChosen(tab.key)}
            className={`shrink-0 rounded-t-md px-3 py-2 text-sm font-medium ${
              tab.key === active ? 'border-b-2 border-brand-600 text-brand-700' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="application-panel" aria-labelledby={`application-tab-${active}`} className="max-h-[60vh] overflow-y-auto p-4">
        <dl className="space-y-4">
          {(section ? section.answers.map((a) => [a.q, a.a] as [string, string]) : contact.filter(([, v]) => v.trim() !== '')).map(([q, a], i) => (
            <div key={`${active}-${i}`}>
              <dt className="text-sm font-medium text-slate-600">{q}</dt>
              <dd dir="auto" className="mt-1 whitespace-pre-wrap">
                {a}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
```

`src/panel/CandidateCard.tsx`:

```tsx
import { ActionButton } from '../components/ActionButton.tsx';
import { Timer } from '../components/Timer.tsx';
import { useApi } from '../lib/ApiProvider.tsx';
import { formatElapsed, parseServerTime } from '../lib/clock.ts';
import type { Candidate, InterviewStatus } from '../lib/types.ts';
import { rankedPreferences } from './applicationView.ts';

export interface CardInterview {
  id: string;
  status: InterviewStatus;
  started_at: string;
  ended_at: string | null;
}

interface CandidateCardProps {
  candidate: Candidate;
  /** The interview on show, if any: adds the timer and End interview. */
  interview?: CardInterview;
  targetMinutes: number;
}

export function CandidateCard({ candidate, interview, targetMinutes }: CandidateCardProps) {
  const api = useApi();
  const preferences = rankedPreferences(candidate.preferences);
  const details = [candidate.reg_number, candidate.department, candidate.batch].filter((d) => d.trim() !== '').join(' · ');

  return (
    <section aria-label={`Candidate #${candidate.number}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">
            <span className="tabular-nums">#{candidate.number}</span> <bdi>{candidate.full_name}</bdi>
          </h2>
          <p className="text-sm text-slate-600">{details}</p>
        </div>
        {interview?.status === 'in_progress' && (
          <div className="flex items-center gap-3">
            <Timer startedAt={interview.started_at} targetMinutes={targetMinutes} className="text-2xl font-semibold" />
            <ActionButton variant="primary" size="md" action={() => api.endInterview(interview.id)}>
              End interview
            </ActionButton>
          </div>
        )}
        {interview?.status === 'ended' && interview.ended_at && (
          <p className="text-sm font-medium text-slate-600">
            Interview ended · {formatElapsed(parseServerTime(interview.ended_at) - parseServerTime(interview.started_at))}
          </p>
        )}
      </div>
      {preferences.length > 0 && (
        <ol aria-label="Team preferences" className="mt-3 flex flex-wrap gap-2 text-sm">
          {preferences.map((p) => (
            <li key={p.rank} className="rounded-full bg-brand-50 px-2.5 py-0.5 text-brand-700">
              <span className="mr-1 font-semibold tabular-nums">{p.rank}</span>
              {p.team}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run the tests and the type check**

Run: `npm run test:unit && npm run typecheck`
Expected:
- `Tests  123 passed (123)`
- `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/panel/applicationView.ts src/panel/ApplicationTabs.tsx src/panel/CandidateCard.tsx tests/unit/web/application.test.tsx
git commit -m "feat(web): candidate card and application tabs for panelists"
```

---

### Task 5: The panel's live discussion

**Files:**
- Create: `src/panel/useInterviewLive.ts`, `src/panel/ChatPanel.tsx`
- Test: `tests/unit/web/chat.test.tsx`

**Interfaces:**
- Consumes: `api.interviewMessages`, `api.evaluationCount`, `api.postMessage`, `api.subscribeInterview`, `useLiveSnapshot` (Plan 2).
- Produces:
  - `useInterviewLive(interviewId): LiveSnapshot<InterviewLive>`, where `InterviewLive` is `{ messages, evaluationCount }`.
    - There is one subscription per interview, and callers key their components by interview id, so `load` never changes under a mounted hook. This meets the Plan 2 review's condition for reusing `useLiveSnapshot` per interview.
  - `<ChatPanel interviewId live meId>`:
    - the log is `role="log"` named "Messages", and your own messages are marked;
    - the textarea is labelled "Message": Enter sends, and Shift+Enter adds a line break;
    - a blank message is never sent;
    - an optimistic message shows "Sending…", and on failure "Not sent" with **Retry**, which reuses the message id.

- [ ] **Step 1: Write the failing tests**

`tests/unit/web/chat.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ActionProvider } from '../../../src/components/ActionProvider.tsx';
import { ToastProvider } from '../../../src/components/Toasts.tsx';
import { ApiError } from '../../../src/lib/api.ts';
import { ApiProvider } from '../../../src/lib/ApiProvider.tsx';
import type { ChatMessage } from '../../../src/lib/types.ts';
import { ChatPanel } from '../../../src/panel/ChatPanel.tsx';
import { useInterviewLive } from '../../../src/panel/useInterviewLive.ts';
import { fakeApi, type FakeApi } from './helpers.tsx';

const message = (id: string, author_id: string, author_name: string, body: string): ChatMessage => ({
  id, interview_id: 'i7', author_id, author_name, body, created_at: '2026-09-26T09:55:00Z',
});
const existing = [message('m1', 'u1', 'Hamza', 'Strong on teamwork.'), message('m2', 'u-panelist', 'Test panelist', 'Agreed.')];

function Chat() {
  const live = useInterviewLive('i7');
  return <ChatPanel interviewId="i7" live={live} meId="u-panelist" />;
}

function renderChat(api: FakeApi) {
  render(
    <ApiProvider api={api}>
      <ToastProvider>
        <ActionProvider>
          <Chat />
        </ActionProvider>
      </ToastProvider>
    </ApiProvider>,
  );
}

const log = () => screen.getByRole('log', { name: 'Messages' });

describe('the panel discussion', () => {
  it("shows the interview's messages, marking your own", async () => {
    renderChat(fakeApi({ interviewMessages: vi.fn(async () => existing) }));
    expect(await within(log()).findByText('Strong on teamwork.')).toBeInTheDocument();
    expect(log()).toHaveTextContent('Hamza');
    expect(log()).toHaveTextContent('You');
  });

  it('shows a sent message at once, then keeps just the saved copy', async () => {
    let finish!: (m: ChatMessage) => void;
    const postMessage = vi.fn((_interviewId: string, _body: string, _id: string) => new Promise<ChatMessage>((resolve) => (finish = resolve)));
    const api = fakeApi({ interviewMessages: vi.fn(async () => existing), postMessage });
    renderChat(api);
    await within(log()).findByText('Agreed.');

    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Great answer on ownership{Enter}');
    expect(within(log()).getByText('Great answer on ownership')).toBeInTheDocument();
    expect(within(log()).getByText('Sending…')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('');
    const [, body, id] = postMessage.mock.calls[0];
    expect(body).toBe('Great answer on ownership');

    const saved = message(id, 'u-panelist', 'Test panelist', body);
    vi.mocked(api.interviewMessages).mockResolvedValue([...existing, saved]);
    await act(async () => finish(saved));
    await waitFor(() => expect(within(log()).queryByText('Sending…')).toBeNull());
    expect(within(log()).getAllByText('Great answer on ownership')).toHaveLength(1);
  });

  it('offers Retry when a message fails, and retries with the same id so it posts once', async () => {
    const postMessage = vi.fn().mockRejectedValueOnce(new ApiError("Can't reach the server.")).mockImplementation(
      async (_interviewId: string, body: string, id: string) => message(id, 'u-panelist', 'Test panelist', body),
    );
    renderChat(fakeApi({ postMessage }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Ask about Git{Enter}');
    expect(await within(log()).findByText('Not sent')).toBeInTheDocument();

    await userEvent.click(within(log()).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(postMessage).toHaveBeenCalledTimes(2));
    expect(postMessage.mock.calls[1][2]).toBe(postMessage.mock.calls[0][2]);
  });

  it('adds a line break with Shift+Enter and never sends a blank message', async () => {
    const api = fakeApi();
    renderChat(api);
    const box = screen.getByRole('textbox', { name: 'Message' });
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await userEvent.type(box, '   {Enter}');
    expect(api.postMessage).not.toHaveBeenCalled();
    await userEvent.clear(box);
    await userEvent.type(box, 'Line one{Shift>}{Enter}{/Shift}Line two');
    expect(box).toHaveValue('Line one\nLine two');
  });

  it("shows other panelists' messages as they arrive", async () => {
    const api = fakeApi({ interviewMessages: vi.fn(async () => existing) });
    renderChat(api);
    await within(log()).findByText('Agreed.');
    vi.mocked(api.interviewMessages).mockResolvedValue([...existing, message('m3', 'u2', 'Mariam', 'Ask about deadlines.')]);
    act(() => api.topics.interview.event());
    expect(await within(log()).findByText('Ask about deadlines.')).toBeInTheDocument();
    expect(api.subscribeInterview).toHaveBeenCalledWith('i7');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/unit/web/chat.test.tsx`
Expected:
FAIL: `Failed to resolve import "../../../src/panel/ChatPanel.tsx" from "tests/unit/web/chat.test.tsx". Does the file exist?`

- [ ] **Step 3: Write the hook and the chat**

`src/panel/useInterviewLive.ts`:

```ts
import { useCallback, useMemo } from 'react';
import { useApi } from '../lib/ApiProvider.tsx';
import type { ChatMessage } from '../lib/types.ts';
import { useLiveSnapshot, type LiveSnapshot } from '../lib/useLiveSnapshot.ts';

export interface InterviewLive {
  messages: ChatMessage[];
  evaluationCount: number;
}

/**
 * The chat and the number of submitted evaluations for one interview, kept live by the private
 * interview:<id> topic. One subscription per interview: the chat and the evaluation form share it.
 * Components using it are keyed by the interview id, so `load` never changes under a mounted hook.
 */
export function useInterviewLive(interviewId: string): LiveSnapshot<InterviewLive> {
  const api = useApi();
  const load = useCallback(async () => {
    const [messages, evaluationCount] = await Promise.all([api.interviewMessages(interviewId), api.evaluationCount(interviewId)]);
    return { messages, evaluationCount };
  }, [api, interviewId]);
  const subscribe = useMemo(() => api.subscribeInterview(interviewId), [api, interviewId]);
  return useLiveSnapshot(load, subscribe);
}
```

`src/panel/ChatPanel.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { buttonClasses } from '../components/ActionButton.tsx';
import { useApi } from '../lib/ApiProvider.tsx';
import { parseServerTime } from '../lib/clock.ts';
import type { LiveSnapshot } from '../lib/useLiveSnapshot.ts';
import type { InterviewLive } from './useInterviewLive.ts';

const MAX_LENGTH = 2000;

interface Pending {
  id: string;
  body: string;
  failed: boolean;
}

interface ChatPanelProps {
  interviewId: string;
  live: LiveSnapshot<InterviewLive>;
  meId: string;
}

/** The panel's discussion about this candidate. Your messages show at once and are matched to the saved copy. */
export function ChatPanel({ interviewId, live, meId }: ChatPanelProps) {
  const api = useApi();
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const listRef = useRef<HTMLOListElement>(null);
  const saved = live.data?.messages ?? [];
  const savedIds = new Set(saved.map((m) => m.id));
  const unsaved = pending.filter((p) => !savedIds.has(p.id));

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [saved.length, unsaved.length]);

  async function deliver(id: string, body: string) {
    setPending((list) => list.map((p) => (p.id === id ? { ...p, failed: false } : p)));
    try {
      await api.postMessage(interviewId, body, id); // the same id on a retry, so it can't post twice
      live.reload();
    } catch {
      setPending((list) => list.map((p) => (p.id === id ? { ...p, failed: true } : p)));
    }
  }

  function send() {
    const body = draft.trim();
    if (!body || body.length > MAX_LENGTH) return;
    const id = crypto.randomUUID();
    setPending((list) => [...list, { id, body, failed: false }]);
    setDraft('');
    void deliver(id, body);
  }

  const tooLong = draft.trim().length > MAX_LENGTH;
  return (
    <section aria-label="Discussion" className="flex h-full min-h-[22rem] flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-baseline justify-between border-b border-slate-100 px-4 py-3">
        <h2 className="font-semibold">Discussion</h2>
        {live.status === 'reconnecting' && <span className="text-xs font-medium text-amber-700">Reconnecting…</span>}
      </header>
      <ol ref={listRef} role="log" aria-label="Messages" className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {saved.length + unsaved.length === 0 && <li className="text-sm text-slate-500">No messages yet.</li>}
        {saved.map((m) => (
          <MessageItem key={m.id} author={m.author_id === meId ? 'You' : m.author_name} time={m.created_at} body={m.body} />
        ))}
        {unsaved.map((p) => (
          <MessageItem key={p.id} author="You" body={p.body} failed={p.failed} sending={!p.failed} onRetry={() => void deliver(p.id, p.body)} />
        ))}
      </ol>
      <form
        className="space-y-2 border-t border-slate-100 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          aria-label="Message"
          value={draft}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Write to the panel. Enter sends, Shift+Enter adds a line."
          className="block w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-600 focus:ring-2 focus:ring-brand-100 focus:outline-none"
        />
        <div className="flex items-center justify-between gap-2">
          <span className={`text-xs ${tooLong ? 'text-red-700' : 'text-slate-500'}`}>
            {draft.length > MAX_LENGTH - 200 ? `${draft.trim().length} / ${MAX_LENGTH}` : ''}
          </span>
          <button type="submit" className={buttonClasses('primary')} disabled={draft.trim() === '' || tooLong}>
            Send
          </button>
        </div>
      </form>
    </section>
  );
}

interface MessageItemProps {
  author: string;
  body: string;
  time?: string;
  sending?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

function MessageItem({ author, body, time, sending, failed, onRetry }: MessageItemProps) {
  return (
    <li className={author === 'You' ? 'ml-6' : 'mr-6'}>
      <p className="flex items-baseline gap-2 text-xs text-slate-500">
        <span className="font-semibold text-slate-700">{author}</span>
        {time && <time dateTime={time}>{new Date(parseServerTime(time)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>}
        {sending && <span>Sending…</span>}
        {failed && (
          <>
            <span className="font-medium text-red-700">Not sent</span>
            <button type="button" className="font-medium text-brand-700 underline" onClick={onRetry}>
              Retry
            </button>
          </>
        )}
      </p>
      <p dir="auto" className={`mt-0.5 rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${author === 'You' ? 'bg-brand-50' : 'bg-slate-100'} ${failed ? 'opacity-60' : ''}`}>
        {body}
      </p>
    </li>
  );
}
```

- [ ] **Step 4: Run the tests and the type check**

Run: `npm run test:unit && npm run typecheck`
Expected:
- `Tests  128 passed (128)`
- `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/panel/useInterviewLive.ts src/panel/ChatPanel.tsx tests/unit/web/chat.test.tsx
git commit -m "feat(web): live panel discussion with optimistic sends and retry"
```

---

### Task 6: The evaluation form

**Files:**
- Create: `src/panel/evaluation.ts`, `src/panel/EvaluationForm.tsx`
- Test: `tests/unit/web/evaluation.test.ts`, `tests/unit/web/evaluationForm.test.tsx`

**Interfaces:**
- Consumes: `api.submitEvaluation`, `Criterion`, `MyEvaluation`, `Recommendation`, `Scores`, `ActionProvider`/`useRunAction` (Plan 2).
- Produces:
  - `RECOMMENDATIONS` (Strong Yes, Yes, Maybe, No, in that order) and `MAX_COMMENTS = 5000`.
  - `EvaluationDraft` (`{ scores, recommendation, comments }`) and `draftFromEvaluation(saved?)`.
  - `draftKey(userId, interviewId)`, `loadDraft(key)` (null if there is no draft, it is damaged, or storage is blocked), `saveDraft`, `clearDraft`.
  - `sameAsSaved(draft, saved?)` and `validateDraft(draft)`: a recommendation is required, and comments can be at most `MAX_COMMENTS` characters.
  - `<EvaluationForm interviewId userId criteria saved? evaluationCount locked onSubmitted>`:
    - General criteria are 1–5 or "–" (no score). Team-fit criteria are 1–5 or N/A.
    - It sends only the scores that were given.
    - It keeps a draft on this device until you submit, and starts from your submitted evaluation.
    - It is read-only when `locked`, and shows how many panelists have submitted.
    - Each score group is a `fieldset` with a visually hidden legend.

- [ ] **Step 1: Write the failing tests**

`tests/unit/web/evaluation.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { draftFromEvaluation, loadDraft, saveDraft, validateDraft, type EvaluationDraft } from '../../../src/panel/evaluation.ts';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
}

describe('evaluation drafts', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('round-trips a draft', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const draft: EvaluationDraft = { scores: { communication: 4 }, recommendation: 'maybe', comments: 'Quiet but thoughtful' };
    saveDraft('k', draft);
    expect(loadDraft('k')).toEqual(draft);
  });

  it('ignores drafts it cannot trust, and storage that refuses to work', () => {
    vi.stubGlobal('localStorage', memoryStorage({ broken: '{not json', wrong: JSON.stringify({ scores: { communication: 9 }, recommendation: 'yes', comments: '' }) }));
    expect(loadDraft('broken')).toBeNull();
    expect(loadDraft('wrong')).toBeNull(); // a score outside 1–5
    expect(loadDraft('missing')).toBeNull();
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } });
    expect(loadDraft('k')).toBeNull();
    expect(() => saveDraft('k', draftFromEvaluation())).not.toThrow();
  });
});

describe('validateDraft', () => {
  it('requires only a recommendation, and caps comments at 5000 characters', () => {
    expect(validateDraft({ scores: {}, recommendation: null, comments: '' })).toBe('Choose a recommendation before submitting.');
    expect(validateDraft({ scores: {}, recommendation: 'no', comments: '' })).toBeNull();
    expect(validateDraft({ scores: {}, recommendation: 'yes', comments: 'x'.repeat(5001) })).toBe('Comments must be at most 5000 characters.');
  });
});
```

`tests/unit/web/evaluationForm.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionProvider } from '../../../src/components/ActionProvider.tsx';
import { ToastProvider } from '../../../src/components/Toasts.tsx';
import { ApiProvider } from '../../../src/lib/ApiProvider.tsx';
import type { MyEvaluation } from '../../../src/lib/types.ts';
import { draftKey } from '../../../src/panel/evaluation.ts';
import { EvaluationForm } from '../../../src/panel/EvaluationForm.tsx';
import { criteriaList } from './fixtures.ts';
import { fakeApi, type FakeApi } from './helpers.tsx';

function renderForm(api: FakeApi = fakeApi(), props: { saved?: MyEvaluation; locked?: boolean; count?: number } = {}) {
  const onSubmitted = vi.fn();
  const view = render(
    <ApiProvider api={api}>
      <ToastProvider>
        <ActionProvider>
          <EvaluationForm
            interviewId="i7"
            userId="u-panelist"
            criteria={criteriaList()}
            saved={props.saved}
            evaluationCount={props.count ?? 0}
            locked={props.locked ?? false}
            onSubmitted={onSubmitted}
          />
        </ActionProvider>
      </ToastProvider>
    </ApiProvider>,
  );
  return { api, onSubmitted, ...view };
}

const choose = (group: string, option: string) => userEvent.click(within(screen.getByRole('group', { name: group })).getByRole('radio', { name: option }));

describe('EvaluationForm', () => {
  beforeEach(() => localStorage.clear());

  it('lists every criterion and requires a recommendation', async () => {
    const { api } = renderForm();
    for (const name of ['Communication', 'Confidence & Attitude', 'Teamwork', 'Commitment', 'Problem Solving']) {
      expect(within(screen.getByRole('group', { name })).getAllByRole('radio')).toHaveLength(6); // 1–5 and "No score"
    }
    expect(within(screen.getByRole('group', { name: 'Dev' })).getByRole('radio', { name: 'N/A' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Submit evaluation' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a recommendation before submitting.');
    expect(api.submitEvaluation).not.toHaveBeenCalled();
  });

  it('sends only the scores given, leaving N/A out', async () => {
    const { api, onSubmitted } = renderForm();
    await choose('Communication', '4');
    await choose('Teamwork', '5');
    await choose('Dev', '5');
    await choose('Overall recommendation', 'Yes');
    await userEvent.type(screen.getByRole('textbox', { name: 'Comments (optional)' }), 'Good ownership');
    await userEvent.click(screen.getByRole('button', { name: 'Submit evaluation' }));
    expect(api.submitEvaluation).toHaveBeenCalledWith('i7', { communication: 4, teamwork: 5, fit_dev: 5 }, 'yes', 'Good ownership');
    expect(await screen.findByText('Evaluation submitted')).toBeInTheDocument();
    expect(onSubmitted).toHaveBeenCalled();
  });

  it('keeps a draft on this device until it is submitted', async () => {
    const first = renderForm();
    await choose('Overall recommendation', 'Maybe');
    await userEvent.type(screen.getByRole('textbox', { name: 'Comments (optional)' }), 'Quiet but thoughtful');
    expect(screen.getByText('Draft saved on this device')).toBeInTheDocument();
    first.unmount();

    const second = renderForm();
    expect(screen.getByRole('textbox', { name: 'Comments (optional)' })).toHaveValue('Quiet but thoughtful');
    expect(within(screen.getByRole('group', { name: 'Overall recommendation' })).getByRole('radio', { name: 'Maybe' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Submit evaluation' }));
    await waitFor(() => expect(second.onSubmitted).toHaveBeenCalled());
    expect(localStorage.getItem(draftKey('u-panelist', 'i7'))).toBeNull();
  });

  it('starts from your submitted evaluation and lets you update it', () => {
    renderForm(fakeApi(), {
      saved: { interview_id: 'i7', scores: { communication: 3 }, recommendation: 'no', comments: 'Unprepared', updated_at: '2026-09-26T10:07:00Z' },
    });
    expect(within(screen.getByRole('group', { name: 'Communication' })).getByRole('radio', { name: '3' })).toBeChecked();
    expect(within(screen.getByRole('group', { name: 'Overall recommendation' })).getByRole('radio', { name: 'No' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Update evaluation' })).toBeEnabled();
  });

  it('is read-only once results are published', () => {
    renderForm(fakeApi(), { locked: true });
    expect(screen.getByText('Results are published; evaluations are locked.')).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Communication' })).getByRole('radio', { name: '4' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Submit evaluation' })).toBeDisabled();
  });

  it('says how many panelists have submitted', () => {
    const { unmount } = renderForm(fakeApi(), { count: 0 });
    expect(screen.getByText('No one has submitted yet')).toBeInTheDocument();
    unmount();
    renderForm(fakeApi(), { count: 2 });
    expect(screen.getByText('2 panelists have submitted')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/unit/web/evaluation.test.ts tests/unit/web/evaluationForm.test.tsx`
Expected:
FAIL: both files fail to load, because `../../../src/panel/evaluation.ts` does not exist yet.

- [ ] **Step 3: Write the draft helpers and the form**

`src/panel/evaluation.ts`:

```ts
// The evaluation form's data: drafts kept on this device, validation, and the submitted shape.
import type { MyEvaluation, Recommendation, Scores } from '../lib/types.ts';

export interface EvaluationDraft {
  scores: Scores;
  recommendation: Recommendation | null;
  comments: string;
}

export const RECOMMENDATIONS: Array<{ value: Recommendation; label: string }> = [
  { value: 'strong_yes', label: 'Strong Yes' },
  { value: 'yes', label: 'Yes' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'no', label: 'No' },
];

export const MAX_COMMENTS = 5000;

export function draftFromEvaluation(saved?: MyEvaluation): EvaluationDraft {
  return saved
    ? { scores: { ...saved.scores }, recommendation: saved.recommendation, comments: saved.comments }
    : { scores: {}, recommendation: null, comments: '' };
}

/** Per person and interview, so panelists sharing a laptop never see each other's drafts. */
export function draftKey(userId: string, interviewId: string): string {
  return `induction:evaluation-draft:${userId}:${interviewId}`;
}

function isDraft(value: unknown): value is EvaluationDraft {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Record<string, unknown>;
  const scoresOk =
    typeof d.scores === 'object' &&
    d.scores !== null &&
    Object.values(d.scores).every((v) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5);
  const recommendationOk = d.recommendation === null || RECOMMENDATIONS.some((r) => r.value === d.recommendation);
  return scoresOk && recommendationOk && typeof d.comments === 'string';
}

/** The saved draft, or null if there is none, it is damaged, or storage is unavailable (private mode). */
export function loadDraft(key: string): EvaluationDraft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveDraft(key: string, draft: EvaluationDraft): void {
  try {
    localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Storage full or blocked: the form still works, the draft just won't survive a reload.
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing to do.
  }
}

export function sameAsSaved(draft: EvaluationDraft, saved?: MyEvaluation): boolean {
  return JSON.stringify(draft) === JSON.stringify(draftFromEvaluation(saved));
}

/** Only the recommendation is required (spec §5); scores may be left blank. */
export function validateDraft(draft: EvaluationDraft): string | null {
  if (!draft.recommendation) return 'Choose a recommendation before submitting.';
  if (draft.comments.length > MAX_COMMENTS) return `Comments must be at most ${MAX_COMMENTS} characters.`;
  return null;
}
```

`src/panel/EvaluationForm.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { buttonClasses } from '../components/ActionButton.tsx';
import { useToast } from '../components/Toasts.tsx';
import { errorMessage } from '../lib/api.ts';
import { useApi } from '../lib/ApiProvider.tsx';
import { parseServerTime } from '../lib/clock.ts';
import type { Criterion, MyEvaluation, Recommendation } from '../lib/types.ts';
import {
  clearDraft,
  draftFromEvaluation,
  draftKey,
  loadDraft,
  MAX_COMMENTS,
  RECOMMENDATIONS,
  saveDraft,
  sameAsSaved,
  validateDraft,
  type EvaluationDraft,
} from './evaluation.ts';

interface EvaluationFormProps {
  interviewId: string;
  userId: string;
  criteria: Criterion[];
  /** This person's submitted evaluation for the interview, if any. */
  saved?: MyEvaluation;
  evaluationCount: number;
  /** Results are published: the server refuses changes, so the form is read-only. */
  locked: boolean;
  onSubmitted: () => void;
}

/** "My evaluation". Keyed by interview id by its parent, so each interview starts from its own draft. */
export function EvaluationForm({ interviewId, userId, criteria, saved, evaluationCount, locked, onSubmitted }: EvaluationFormProps) {
  const api = useApi();
  const toast = useToast();
  const key = draftKey(userId, interviewId);
  const [draft, setDraft] = useState<EvaluationDraft>(() => loadDraft(key) ?? draftFromEvaluation(saved));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const dirty = !sameAsSaved(draft, saved);

  useEffect(() => {
    if (dirty) saveDraft(key, draft);
    else clearDraft(key);
  }, [key, draft, dirty]);

  const setScore = (criterion: string, value: number | null) =>
    setDraft((d) => {
      const scores = { ...d.scores };
      if (value === null) delete scores[criterion];
      else scores[criterion] = value;
      return { ...d, scores };
    });

  async function submit() {
    const problem = validateDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await api.submitEvaluation(interviewId, draft.scores, draft.recommendation as Recommendation, draft.comments.trim());
      clearDraft(key);
      toast.show('Evaluation submitted', 'success');
      onSubmitted();
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const general = criteria.filter((c) => c.category === 'general');
  const teamFit = criteria.filter((c) => c.category === 'team_fit');
  const submittedAt = saved ? new Date(parseServerTime(saved.updated_at)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <section aria-label="My evaluation" className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <h2 className="font-semibold">My evaluation</h2>
        <span className="text-sm text-slate-600">
          {evaluationCount === 0
            ? 'No one has submitted yet'
            : `${evaluationCount} panelist${evaluationCount === 1 ? ' has' : 's have'} submitted`}
        </span>
      </header>
      <form
        className="space-y-5 px-4 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {locked && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">Results are published; evaluations are locked.</p>
        )}
        <fieldset disabled={locked || submitting} className="space-y-5">
          <ScoreGroup title="General (1–5)" criteria={general} clearLabel="–" clearName="No score" draft={draft} interviewId={interviewId} onChange={setScore} />
          <ScoreGroup title="Team fit (1–5 or N/A)" criteria={teamFit} clearLabel="N/A" clearName="N/A" draft={draft} interviewId={interviewId} onChange={setScore} />

          <fieldset>
            <legend className="text-sm font-semibold">Overall recommendation</legend>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {RECOMMENDATIONS.map((r) => (
                <label
                  key={r.value}
                  className={`flex cursor-pointer items-center justify-center gap-2 rounded-md border px-2 py-2 text-sm font-medium has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700 ${
                    locked ? 'cursor-not-allowed opacity-60' : 'border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    name={`${interviewId}-recommendation`}
                    checked={draft.recommendation === r.value}
                    onChange={() => setDraft((d) => ({ ...d, recommendation: r.value }))}
                  />
                  {r.label}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="block text-sm font-semibold">
            Comments (optional)
            <textarea
              value={draft.comments}
              onChange={(e) => setDraft((d) => ({ ...d, comments: e.target.value }))}
              rows={4}
              maxLength={MAX_COMMENTS}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-normal focus:border-brand-600 focus:ring-2 focus:ring-brand-100 focus:outline-none"
            />
          </label>
        </fieldset>

        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-slate-500">
            {submittedAt ? `You submitted at ${submittedAt}${dirty ? ' · unsaved changes' : ''}` : dirty ? 'Draft saved on this device' : ''}
          </span>
          <button type="submit" className={buttonClasses('primary', 'md')} disabled={locked || submitting}>
            {saved ? 'Update evaluation' : 'Submit evaluation'}
          </button>
        </div>
      </form>
    </section>
  );
}

interface ScoreGroupProps {
  title: string;
  criteria: Criterion[];
  clearLabel: string;
  clearName: string;
  draft: EvaluationDraft;
  interviewId: string;
  onChange: (criterion: string, value: number | null) => void;
}

function ScoreGroup({ title, criteria, clearLabel, clearName, draft, interviewId, onChange }: ScoreGroupProps) {
  if (criteria.length === 0) return null;
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {criteria.map((c) => (
        // Label above the buttons on a phone, beside them on wider screens. The legend names the group.
        <fieldset key={c.key} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-3">
          <legend className="sr-only">{c.label}</legend>
          <span aria-hidden="true" className="text-sm text-slate-700">
            {c.label}
          </span>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5, null].map((value) => (
              <label
                key={value ?? 'clear'}
                className={`flex h-8 min-w-8 cursor-pointer items-center justify-center rounded-md border px-2 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 ${
                  value === null
                    ? 'border-slate-200 text-slate-500 has-[:checked]:bg-slate-100 has-[:checked]:text-slate-700'
                    : 'border-slate-300 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-600 has-[:checked]:text-white'
                }`}
              >
                <input
                  type="radio"
                  className="sr-only"
                  name={`${interviewId}-${c.key}`}
                  aria-label={value === null ? clearName : String(value)}
                  checked={value === null ? draft.scores[c.key] === undefined : draft.scores[c.key] === value}
                  onChange={() => onChange(c.key, value)}
                />
                {value ?? clearLabel}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests and the type check**

Run: `npm run test:unit && npm run typecheck`
Expected:
- `Tests  137 passed (137)`
- `tsc` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/panel/evaluation.ts src/panel/EvaluationForm.tsx tests/unit/web/evaluation.test.ts tests/unit/web/evaluationForm.test.tsx
git commit -m "feat(web): evaluation form with drafts kept on the device"
```

---

### Task 7: The panelist screen

**Files:**
- Create: `src/panel/panelView.ts`, `src/panel/RecentInterviews.tsx`, `src/panel/FindCandidate.tsx`, `src/panel/InterviewWorkspace.tsx`, `src/panel/PanelPage.tsx`
- Modify: `src/app/routes.tsx`
- Test: `tests/unit/web/panelPage.test.tsx`

**Interfaces:**
- Consumes:
  - Tasks 4–6 (`CandidateCard`, `ApplicationTabs`, `useInterviewLive`, `ChatPanel`, `EvaluationForm`).
  - `api.boardSnapshot`, `api.subscribeBoard`, `api.setMyPanel`, `api.candidate`, `api.panelInterviews`, `api.criteria`, `api.myEvaluations`.
  - `useCandidates` and `searchCandidates` (Plan 2, for search).
- Produces:
  - `myPanel(board, userId)`: the panel whose "panelists present" list includes you.
  - `shownInterview(panel, recent, pinnedId)`: the interview on show. It is the one you opened from Recent if any; otherwise the one in progress; otherwise the panel's latest, which stays open after it ends.
  - `recentList(recent, shownId, evaluated)`: the other interviews, marked `pending` until you have evaluated them.
  - `<PanelPage>` at `/panel`:
    - On first visit it asks "Which panel are you sitting in?".
    - The header has a "Your panel" select, where "Not in a panel" leaves the panel.
    - It shows "Up next" (the first person in the panel's lane).
    - It shows the interview workspace, the Recent list with "Evaluation pending" badges, and "Back to the current interview".
    - "Find a candidate" opens any application read-only in a dialog named "Application of #N Name".
  - `<InterviewWorkspace>`: the card, the application, the chat and the evaluation. On narrow screens they sit behind three tabs: Application, Chat and Evaluate.

- [ ] **Step 1: Write the failing tests**

`tests/unit/web/panelPage.test.tsx`:

```tsx
// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Api } from '../../../src/lib/api.ts';
import type { BoardSnapshot, PanelInterview } from '../../../src/lib/types.ts';
import { board, boardPanel, candidateRow, interview, lane, profile } from './fixtures.ts';
import { fakeApi, fakeAuth, renderApp } from './helpers.tsx';

const me = { id: 'u-panelist', display_name: 'Test panelist' };

/** Panel 1 with you in it; by default #7 Sara Ahmed is being interviewed and #12 is lined up. */
function boardWithMe(panel1: Parameters<typeof boardPanel>[2] = {}, overrides: Partial<BoardSnapshot> = {}): BoardSnapshot {
  return board({
    panels: [
      boardPanel('p1', 'Panel 1', { is_default: true, current: interview(7, 'Sara Ahmed'), lane: lane([12, 'Ali Raza']), panelists: [me], ...panel1 }),
      boardPanel('p2', 'Panel 2', { is_default: true }),
    ],
    ...overrides,
  });
}

const past = (n: number, name: string, status: PanelInterview['status'] = 'ended'): PanelInterview => ({
  id: `i${n}`, status, started_at: `2026-09-26T09:${String(n).padStart(2, '0')}:00Z`, ended_at: status === 'ended' ? '2026-09-26T10:00:00Z' : null,
  candidate: { id: `c${n}`, number: n, full_name: name },
});

async function openPanel(overrides: Partial<Api> = {}) {
  const api = fakeApi({ boardSnapshot: vi.fn(async () => boardWithMe()), ...overrides });
  const view = renderApp('/panel', { api, auth: fakeAuth({ signedInAs: profile('panelist') }).backend });
  return { ...view, api };
}

describe('the panelist screen', () => {
  it('asks which panel you are sitting in on your first visit', async () => {
    const { api } = await openPanel({ boardSnapshot: vi.fn(async () => board()) });
    expect(await screen.findByRole('heading', { name: 'Which panel are you sitting in?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Panel 2' }));
    expect(api.setMyPanel).toHaveBeenCalledWith('p2');
  });

  it('shows the candidate being interviewed with the application, the discussion and your evaluation', async () => {
    const { api } = await openPanel();
    expect(await screen.findByRole('heading', { name: '#7 Sara Ahmed' })).toBeInTheDocument();
    expect(api.candidate).toHaveBeenCalledWith('c7');
    expect(screen.getByRole('region', { name: 'Application' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Discussion' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'My evaluation' })).toBeInTheDocument();
    expect(api.subscribeInterview).toHaveBeenCalledWith('i7');
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Up next: #12 Ali Raza')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'End interview' }));
    expect(api.endInterview).toHaveBeenCalledWith('i7');
  });

  it('keeps the last interview open after it ends, and lists earlier ones with pending evaluations', async () => {
    const { api } = await openPanel({
      boardSnapshot: vi.fn(async () => boardWithMe({ current: null })),
      candidate: vi.fn(async (id: string) => candidateRow({ id, number: Number(id.slice(1)), full_name: id === 'c5' ? 'Hina Tariq' : 'Sara Ahmed' })),
      panelInterviews: vi.fn(async () => [past(7, 'Sara Ahmed'), past(6, 'Omar Farooq'), past(5, 'Hina Tariq')]),
      myEvaluations: vi.fn(async () => [{ interview_id: 'i6', scores: {}, recommendation: 'yes' as const, comments: '', updated_at: '2026-09-26T10:01:00Z' }]),
    });
    expect(await screen.findByText(/^Interview ended/)).toBeInTheDocument();
    const recent = await screen.findByRole('region', { name: 'Recent' });
    await waitFor(() => expect(within(recent).getAllByRole('listitem')).toHaveLength(2));
    const [omar, hina] = within(recent).getAllByRole('listitem');
    expect(omar).not.toHaveTextContent('Evaluation pending');
    expect(hina).toHaveTextContent('Evaluation pending');

    await userEvent.click(within(hina).getByRole('button', { name: '#5 Hina Tariq' }));
    expect(await screen.findByRole('heading', { name: '#5 Hina Tariq' })).toBeInTheDocument();
    expect(api.candidate).toHaveBeenLastCalledWith('c5');
    await userEvent.click(screen.getByRole('button', { name: 'Back to the current interview' }));
    expect(await screen.findByRole('heading', { name: '#7 Sara Ahmed' })).toBeInTheDocument();
  });

  it('switches panel from the header', async () => {
    const { api } = await openPanel();
    await screen.findByRole('heading', { name: '#7 Sara Ahmed' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Your panel' }), 'Panel 2');
    expect(api.setMyPanel).toHaveBeenCalledWith('p2');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Your panel' }), 'Not in a panel');
    expect(api.setMyPanel).toHaveBeenLastCalledWith(null);
  });

  it('locks evaluations once results are published', async () => {
    const published = boardWithMe({}, { induction: { id: 'ind-1', name: 'Fall 2026', target_interview_minutes: 15, results_published: true } });
    await openPanel({ boardSnapshot: vi.fn(async () => published) });
    const form = await screen.findByRole('region', { name: 'My evaluation' });
    expect(within(form).getByText('Results are published; evaluations are locked.')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Submit evaluation' })).toBeDisabled();
  });

  it("opens any candidate's application read-only from search", async () => {
    const { api } = await openPanel({
      listCandidates: vi.fn(async () => [{ id: 'c5', number: 5, full_name: 'Hina Tariq', reg_number: '2025005', status: 'registered' as const }]),
      candidate: vi.fn(async (id: string) => candidateRow({ id, number: id === 'c5' ? 5 : 7, full_name: id === 'c5' ? 'Hina Tariq' : 'Sara Ahmed' })),
    });
    await screen.findByRole('heading', { name: '#7 Sara Ahmed' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Find a candidate' }), 'hina');
    await userEvent.click(await screen.findByRole('button', { name: /#5 Hina Tariq/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Application of #5 Hina Tariq' });
    expect(within(dialog).getByRole('tablist', { name: 'Application sections' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'End interview' })).toBeNull();
    expect(api.candidate).toHaveBeenLastCalledWith('c5');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/unit/web/panelPage.test.tsx`
Expected:
FAIL: all 6 tests fail, because `/panel` still shows the Plan 2 placeholder. For example: `Unable to find role="heading" and name "Which panel are you sitting in?"`.

- [ ] **Step 3: Write the view logic and the screen**

`src/panel/panelView.ts`:

```ts
// Pure decisions behind the panelist screen.
import type { BoardPanel, BoardSnapshot, InterviewStatus, PanelInterview } from '../lib/types.ts';

/** The panel this person is sitting in, from the board's "panelists present" lists. */
export function myPanel(board: BoardSnapshot, userId: string): BoardPanel | null {
  return board.panels.find((panel) => panel.panelists.some((p) => p.id === userId)) ?? null;
}

export interface ShownInterview {
  id: string;
  candidateId: string;
  status: InterviewStatus;
  startedAt: string;
  endedAt: string | null;
}

const fromPanelInterview = (i: PanelInterview): ShownInterview => ({
  id: i.id,
  candidateId: i.candidate.id,
  status: i.status,
  startedAt: i.started_at,
  endedAt: i.ended_at,
});

/**
 * What the panelist sees: an interview they opened from Recent; otherwise the one in progress;
 * otherwise the panel's latest one, which stays open after it ends (spec §9).
 */
export function shownInterview(panel: BoardPanel, recent: PanelInterview[], pinnedId: string | null): ShownInterview | null {
  const pinned = pinnedId ? recent.find((i) => i.id === pinnedId) : undefined;
  if (pinned) return fromPanelInterview(pinned);
  if (panel.current) {
    return {
      id: panel.current.interview_id,
      candidateId: panel.current.candidate_id,
      status: 'in_progress',
      startedAt: panel.current.started_at,
      endedAt: null,
    };
  }
  return recent[0] ? fromPanelInterview(recent[0]) : null;
}

/** The panel's other interviews, newest first, marking those this panelist hasn't evaluated. */
export function recentList(recent: PanelInterview[], shownId: string | null, evaluated: Set<string>) {
  return recent.filter((i) => i.id !== shownId).map((i) => ({ ...i, pending: !evaluated.has(i.id) }));
}
```

`src/panel/RecentInterviews.tsx`:

```tsx
import type { PanelInterview } from '../lib/types.ts';

interface RecentInterviewsProps {
  items: Array<PanelInterview & { pending: boolean }>;
  onOpen: (interviewId: string) => void;
}

/** The panel's earlier interviews; "Evaluation pending" until this panelist submits one. */
export function RecentInterviews({ items, onOpen }: RecentInterviewsProps) {
  return (
    <section aria-labelledby="recent-title" className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <h2 id="recent-title" className="border-b border-slate-100 px-4 py-3 font-semibold">
        Recent
      </h2>
      {items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-500">No earlier interviews on this panel yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
              <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => onOpen(item.id)}>
                <span className="tabular-nums">#{item.candidate.number}</span> <bdi>{item.candidate.full_name}</bdi>
              </button>
              {item.status === 'in_progress' && <span className="text-xs text-sky-700">in progress</span>}
              {item.pending && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">Evaluation pending</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

`src/panel/FindCandidate.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { buttonClasses } from '../components/ActionButton.tsx';
import { errorMessage } from '../lib/api.ts';
import { useApi } from '../lib/ApiProvider.tsx';
import type { BoardSnapshot, Candidate } from '../lib/types.ts';
import { searchCandidates } from '../queue/queueView.ts';
import { useCandidates } from '../queue/useCandidates.ts';
import { ApplicationTabs } from './ApplicationTabs.tsx';
import { CandidateCard } from './CandidateCard.tsx';

/** Search any candidate and read their application (read-only, no chat or evaluation). */
export function FindCandidate({ board }: { board: BoardSnapshot }) {
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const searching = query.trim() !== '';
  const { list } = useCandidates(board, searching);
  const results = searching && list ? searchCandidates(list, query, 8) : [];

  return (
    <div className="relative w-full max-w-sm">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a candidate by number, name or reg"
        aria-label="Find a candidate"
        className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm focus:border-brand-600 focus:ring-2 focus:ring-brand-100 focus:outline-none"
      />
      {searching && list && (
        <ul className="absolute top-11 right-0 left-0 z-20 max-h-80 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {results.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No candidate matches “{query.trim()}”.</li>}
          {results.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={() => {
                  setOpenId(c.id);
                  setQuery('');
                }}
              >
                <span className="tabular-nums">#{c.number}</span> <bdi>{c.full_name}</bdi>
                <span className="ml-2 text-xs text-slate-500">{c.reg_number}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {openId && <ApplicationDialog candidateId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function ApplicationDialog({ candidateId, onClose }: { candidateId: string; onClose: () => void }) {
  const api = useApi();
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    api.candidate(candidateId).then(
      (row) => current && setCandidate(row),
      (e) => current && setError(errorMessage(e)),
    );
    return () => {
      current = false;
    };
  }, [api, candidateId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const title = candidate ? `Application of #${candidate.number} ${candidate.full_name}` : 'Application';
  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-10"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-3xl space-y-3 rounded-xl bg-slate-50 p-4 shadow-xl">
        <div className="flex justify-end">
          <button type="button" className={buttonClasses('ghost')} onClick={onClose}>
            Close
          </button>
        </div>
        {candidate ? (
          <>
            <CandidateCard candidate={candidate} targetMinutes={0} />
            <ApplicationTabs candidate={candidate} />
          </>
        ) : (
          <p role={error ? 'alert' : undefined} className="text-sm text-slate-600">
            {error ?? 'Loading…'}
          </p>
        )}
      </div>
    </div>
  );
}
```

`src/panel/InterviewWorkspace.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { errorMessage } from '../lib/api.ts';
import { useApi } from '../lib/ApiProvider.tsx';
import type { Candidate, Criterion, MyEvaluation } from '../lib/types.ts';
import { ApplicationTabs } from './ApplicationTabs.tsx';
import { CandidateCard } from './CandidateCard.tsx';
import { ChatPanel } from './ChatPanel.tsx';
import { EvaluationForm } from './EvaluationForm.tsx';
import type { ShownInterview } from './panelView.ts';
import { useInterviewLive } from './useInterviewLive.ts';

type PhoneTab = 'application' | 'chat' | 'evaluate';

interface InterviewWorkspaceProps {
  interview: ShownInterview;
  userId: string;
  criteria: Criterion[];
  /** undefined while this person's evaluations are still loading. */
  evaluations: MyEvaluation[] | undefined;
  locked: boolean;
  targetMinutes: number;
  onEvaluationSubmitted: () => void;
}

/** Application · Discussion · My evaluation for one interview. Keyed by interview id by its parent. */
export function InterviewWorkspace({ interview, userId, criteria, evaluations, locked, targetMinutes, onEvaluationSubmitted }: InterviewWorkspaceProps) {
  const api = useApi();
  const live = useInterviewLive(interview.id);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<PhoneTab>('application');

  useEffect(() => {
    let current = true;
    api.candidate(interview.candidateId).then(
      (row) => current && setCandidate(row),
      (e) => current && setLoadError(errorMessage(e)),
    );
    return () => {
      current = false;
    };
  }, [api, interview.candidateId]);

  const saved = evaluations?.find((e) => e.interview_id === interview.id);
  const show = (which: PhoneTab) => (tab === which ? '' : 'hidden lg:block');

  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Show" className="flex gap-1 rounded-lg bg-slate-100 p-1 lg:hidden">
        {(['application', 'chat', 'evaluate'] as const).map((which) => (
          <button
            key={which}
            type="button"
            role="tab"
            aria-selected={tab === which}
            onClick={() => setTab(which)}
            className={`flex-1 rounded-md py-2 text-sm font-medium ${tab === which ? 'bg-white shadow-sm' : 'text-slate-600'}`}
          >
            {which === 'application' ? 'Application' : which === 'chat' ? 'Chat' : 'Evaluate'}
          </button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className={`space-y-4 ${show('application')}`}>
          {candidate ? (
            <>
              <CandidateCard
                candidate={candidate}
                interview={{ id: interview.id, status: interview.status, started_at: interview.startedAt, ended_at: interview.endedAt }}
                targetMinutes={targetMinutes}
              />
              <ApplicationTabs candidate={candidate} />
            </>
          ) : (
            <p role={loadError ? 'alert' : undefined} className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
              {loadError ?? 'Loading the application…'}
            </p>
          )}
        </div>
        <div className={show('chat')}>
          <ChatPanel interviewId={interview.id} live={live} meId={userId} />
        </div>
        <div className={show('evaluate')}>
          {evaluations && (
            <EvaluationForm
              key={saved?.updated_at ?? 'new'}
              interviewId={interview.id}
              userId={userId}
              criteria={criteria}
              saved={saved}
              evaluationCount={live.data?.evaluationCount ?? 0}
              locked={locked}
              onSubmitted={() => {
                live.reload();
                onEvaluationSubmitted();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
```

`src/panel/PanelPage.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider.tsx';
import { ActionButton, buttonClasses } from '../components/ActionButton.tsx';
import { ActionProvider, useRunAction } from '../components/ActionProvider.tsx';
import { ConnectionBanner } from '../components/ConnectionBanner.tsx';
import { FullPageMessage } from '../components/FullPageMessage.tsx';
import { useApi } from '../lib/ApiProvider.tsx';
import type { BoardPanel, BoardSnapshot, Criterion, MyEvaluation, PanelInterview, Profile } from '../lib/types.ts';
import { useLiveSnapshot } from '../lib/useLiveSnapshot.ts';
import { FindCandidate } from './FindCandidate.tsx';
import { InterviewWorkspace } from './InterviewWorkspace.tsx';
import { myPanel, recentList, shownInterview } from './panelView.ts';
import { RecentInterviews } from './RecentInterviews.tsx';

/** /panel: the panelist's screen (admins can open it too). */
export function PanelPage() {
  const api = useApi();
  const { state } = useAuth();
  const subscribe = useMemo(() => api.subscribeBoard(), [api]);
  const { data: board, error, status, reload } = useLiveSnapshot(api.boardSnapshot, subscribe);

  useEffect(() => {
    document.title = 'Panel · MLSA Induction';
  }, []);

  if (state.status !== 'signed_in') return null;
  if (!board) {
    return (
      <FullPageMessage title={error ? "Couldn't load the board" : 'Loading…'}>
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

  const panel = myPanel(board, state.profile.id);
  return (
    <ActionProvider onSettled={reload}>
      <ConnectionBanner status={status} />
      {panel ? <InPanel board={board} panel={panel} me={state.profile} /> : <PanelChooser board={board} />}
    </ActionProvider>
  );
}

function PanelChooser({ board }: { board: BoardSnapshot }) {
  const api = useApi();
  return (
    <main className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-xl font-semibold">Which panel are you sitting in?</h1>
      <p className="text-sm text-slate-600">You can switch any time from the top of the screen.</p>
      <div className="grid gap-2">
        {board.panels.map((panel) => (
          <ActionButton key={panel.id} size="md" action={() => api.setMyPanel(panel.id)}>
            {panel.name}
          </ActionButton>
        ))}
      </div>
    </main>
  );
}

function InPanel({ board, panel, me }: { board: BoardSnapshot; panel: BoardPanel; me: Profile }) {
  const api = useApi();
  const [recent, setRecent] = useState<PanelInterview[]>([]);
  const [evaluations, setEvaluations] = useState<MyEvaluation[] | undefined>(undefined);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const boardVersion = board.server_time;
  const inductionId = board.induction.id;

  useEffect(() => {
    let current = true;
    api.panelInterviews(panel.id).then(
      (rows) => current && setRecent(rows),
      () => {}, // keep the last list; the board banner already shows connection trouble
    );
    return () => {
      current = false;
    };
  }, [api, panel.id, boardVersion]);

  const loadEvaluations = useCallback(() => {
    api.myEvaluations(me.id).then(setEvaluations, () => setEvaluations((e) => e ?? []));
  }, [api, me.id]);
  useEffect(loadEvaluations, [loadEvaluations]);

  useEffect(() => {
    api.criteria(inductionId).then(setCriteria, () => {});
  }, [api, inductionId]);

  const shown = shownInterview(panel, recent, pinnedId);
  const evaluated = new Set((evaluations ?? []).map((e) => e.interview_id));
  const next = panel.lane[0];

  return (
    <main className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">{panel.name}</h1>
        <PanelSwitch board={board} panel={panel} />
        <p className="text-sm text-slate-600">
          {next ? (
            <>
              Up next: <span className="tabular-nums">#{next.number}</span> <bdi>{next.name}</bdi>
            </>
          ) : (
            'Nobody lined up'
          )}
        </p>
        {pinnedId && (
          <button type="button" className={buttonClasses('secondary')} onClick={() => setPinnedId(null)}>
            Back to the current interview
          </button>
        )}
        <div className="ml-auto w-full sm:w-auto">
          <FindCandidate board={board} />
        </div>
      </div>

      {board.induction.results_published && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">Results are published; evaluations are locked.</p>
      )}

      {shown ? (
        <InterviewWorkspace
          key={shown.id}
          interview={shown}
          userId={me.id}
          criteria={criteria}
          evaluations={evaluations}
          locked={board.induction.results_published}
          targetMinutes={board.induction.target_interview_minutes}
          onEvaluationSubmitted={loadEvaluations}
        />
      ) : (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-600">
          Nobody has been interviewed in {panel.name} yet. The candidate appears here as soon as they are sent in.
        </p>
      )}

      <RecentInterviews items={recentList(recent, shown?.id ?? null, evaluated)} onOpen={setPinnedId} />
    </main>
  );
}

function PanelSwitch({ board, panel }: { board: BoardSnapshot; panel: BoardPanel }) {
  const api = useApi();
  const run = useRunAction();
  const [pending, setPending] = useState(false);

  async function change(value: string) {
    setPending(true);
    await run(() => api.setMyPanel(value || null));
    setPending(false);
  }

  return (
    <select
      aria-label="Your panel"
      value={panel.id}
      disabled={pending}
      onChange={(e) => void change(e.target.value)}
      className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
    >
      {board.panels.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
      <option value="">Not in a panel</option>
    </select>
  );
}
```

- [ ] **Step 4: Route `/panel` to it**

Replace `src/app/routes.tsx` with:

```tsx
import type { RouteObject } from 'react-router';
import { DisplayPage } from '../display/DisplayPage.tsx';
import { PanelPage } from '../panel/PanelPage.tsx';
import { QueuePage } from '../queue/QueuePage.tsx';
import { LoginPage } from './LoginPage.tsx';
import { AdminHome, HomeRedirect, NotFound } from './placeholders.tsx';
import { RequireRole } from './RequireRole.tsx';
import { RouteError } from './RouteError.tsx';
import { StaffLayout } from './StaffLayout.tsx';

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  { path: '/display', element: <DisplayPage />, errorElement: <RouteError /> },
  {
    path: '/',
    element: <StaffLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'queue', element: <RequireRole roles={['queue_manager', 'admin']}><QueuePage /></RequireRole> },
      { path: 'panel', element: <RequireRole roles={['panelist', 'admin']}><PanelPage /></RequireRole> },
      { path: 'admin', element: <RequireRole roles={['admin']}><AdminHome /></RequireRole> },
    ],
  },
  { path: '*', element: <NotFound />, errorElement: <RouteError /> },
];
```

- [ ] **Step 5: Run the tests, the type check and the build**

Run: `npm run test:unit && npm run typecheck && npm run build`
Expected:
- `Tests  143 passed (143)`
- `tsc` prints nothing.
- The build ends with `✓ built in …`.

- [ ] **Step 6: Commit**

```bash
git add src/panel/panelView.ts src/panel/RecentInterviews.tsx src/panel/FindCandidate.tsx src/panel/InterviewWorkspace.tsx src/panel/PanelPage.tsx src/app/routes.tsx tests/unit/web/panelPage.test.tsx
git commit -m "feat(web): panelist screen with the application, discussion, evaluation and recent interviews"
```

---

### Task 8: The admin page

**Files:**
- Create: `src/admin/password.ts`, `src/admin/AccountsSection.tsx`, `src/admin/PanelsSection.tsx`, `src/admin/SettingsSection.tsx`, `src/admin/AdminPage.tsx`
- Modify: `src/app/placeholders.tsx`, `src/app/routes.tsx`
- Test: `tests/unit/web/adminPage.test.tsx`

**Interfaces:**
- Consumes:
  - `api.listAccounts`, `api.manageAccount`, `validateCommand` (Plan 1, `supabase/functions/admin-users/validate.ts`), `ROLES` (`supabase/functions/_shared/accounts.ts`), `ROLE_LABELS` (Plan 2).
  - `api.boardSnapshot`, `api.subscribeBoard` and `useLiveSnapshot` (the panels list stays live), `api.addPanel`, `api.deletePanel`.
  - `api.induction`, `api.updateSettings`, `api.getDisplayKey`, `api.regenerateDisplayKey`.
- Produces:
  - `generatePassword(length = 12)`.
  - `settingsProblem(name, minutes)`: the same limits as `update_settings`, a name of 1–80 characters and 1–180 minutes.
  - `<AdminPage>` at `/admin`:
    - a link to Results;
    - the Candidates links (`/queue?list=…`, unchanged from Plan 2);
    - Accounts: list, create, reset password, and disable/enable;
    - Panels: add, and delete any;
    - Settings: name and target minutes;
    - Projector link: copy, open, and "Make a new link".
  - `placeholders.tsx` keeps only `HomeRedirect` and `NotFound`, since Plan 2's `ComingSoon` and `AdminHome` are now replaced.

- [ ] **Step 1: Write the failing tests**

`tests/unit/web/adminPage.test.tsx`:

```tsx
// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../../../src/lib/api.ts';
import { generatePassword } from '../../../src/admin/password.ts';
import { profile } from './fixtures.ts';
import { fakeApi, fakeAuth, renderApp } from './helpers.tsx';

// Real accounts have UUID ids, and the admin-users checks insist on them.
const ids = {
  admin: '6f1c2d3e-0000-4000-8000-000000000001',
  queue: '6f1c2d3e-0000-4000-8000-000000000002',
  mariam: '6f1c2d3e-0000-4000-8000-000000000003',
};
const me = profile('admin', { id: ids.admin });
const accounts = [
  me,
  profile('queue_manager', { id: ids.queue, display_name: 'Queue Desk' }),
  profile('panelist', { id: ids.mariam, username: 'panelist2', display_name: 'Mariam', is_active: false }),
];

async function openAdmin(overrides: Partial<Api> = {}) {
  const api = fakeApi({ listAccounts: vi.fn(async () => accounts), ...overrides });
  const view = renderApp('/admin', { api, auth: fakeAuth({ signedInAs: me }).backend });
  await screen.findByRole('region', { name: 'Accounts' });
  return { ...view, api };
}

/** The accounts table row for a person (their name also appears in the page header, so look inside Accounts). */
const row = async (name: string) => (await within(screen.getByRole('region', { name: 'Accounts' })).findByRole('cell', { name })).closest('tr')!;

describe('generatePassword', () => {
  it('makes 12 easy-to-read characters', () => {
    const password = generatePassword();
    expect(password).toMatch(/^[a-hjkmnp-z2-9]{12}$/);
    expect(generatePassword()).not.toBe(password);
  });
});

describe('the admin page', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists accounts with their role and status, and never offers to disable your own', async () => {
    await openAdmin();
    expect(await row('Queue Desk')).toHaveTextContent('queueQueue managerActive');
    const mariam = await row('Mariam');
    expect(mariam).toHaveTextContent('Disabled');
    expect(within(mariam).getByRole('button', { name: 'Enable Mariam' })).toBeInTheDocument();
    const mine = await row('Test admin');
    expect(within(mine).queryByRole('button', { name: /^Disable/ })).toBeNull();
  });

  it('checks a new account before creating it', async () => {
    const { api } = await openAdmin();
    const form = screen.getByRole('form', { name: 'New account' });
    await userEvent.type(within(form).getByLabelText('Username'), 'Hina T');
    await userEvent.type(within(form).getByLabelText('Name'), 'Hina Tariq');
    await userEvent.type(within(form).getByLabelText('Password'), 'long-password');
    await userEvent.click(within(form).getByRole('button', { name: 'Create account' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('Username must be 3 to 32 characters: lowercase letters, digits or _');
    expect(api.manageAccount).not.toHaveBeenCalled();

    await userEvent.clear(within(form).getByLabelText('Username'));
    await userEvent.type(within(form).getByLabelText('Username'), 'hina_t');
    await userEvent.click(within(form).getByRole('button', { name: 'Create account' }));
    expect(api.manageAccount).toHaveBeenCalledWith({ action: 'create', username: 'hina_t', displayName: 'Hina Tariq', role: 'panelist', password: 'long-password' });
    expect(await screen.findByText('Account created for Hina Tariq. Give them the username and password.')).toBeInTheDocument();
    await waitFor(() => expect(api.listAccounts).toHaveBeenCalledTimes(2));
    expect(within(form).getByLabelText('Username')).toHaveValue('');
  });

  it('fills in a generated password', async () => {
    await openAdmin();
    const form = screen.getByRole('form', { name: 'New account' });
    await userEvent.click(within(form).getByRole('button', { name: 'Generate' }));
    expect((within(form).getByLabelText('Password') as HTMLInputElement).value).toMatch(/^[a-z2-9]{12}$/);
  });

  it('resets a password', async () => {
    const { api } = await openAdmin();
    const queue = await row('Queue Desk');
    await userEvent.click(within(queue).getByRole('button', { name: 'Reset password for Queue Desk' }));
    await userEvent.type(within(queue).getByLabelText('New password for Queue Desk'), 'fresh-password');
    await userEvent.click(within(queue).getByRole('button', { name: 'Save' }));
    expect(api.manageAccount).toHaveBeenCalledWith({ action: 'reset_password', userId: ids.queue, password: 'fresh-password' });
    expect(await screen.findByText('Password reset for Queue Desk')).toBeInTheDocument();
  });

  it('disables an account after confirming, and enables one straight away', async () => {
    const { api } = await openAdmin();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(within(await row('Queue Desk')).getByRole('button', { name: 'Disable Queue Desk' }));
    expect(window.confirm).toHaveBeenCalledWith("Disable Queue Desk? They are signed out and can't sign in until an admin enables the account again.");
    expect(api.manageAccount).toHaveBeenCalledWith({ action: 'set_active', userId: ids.queue, active: false });
    await userEvent.click(within(await row('Mariam')).getByRole('button', { name: 'Enable Mariam' }));
    expect(api.manageAccount).toHaveBeenLastCalledWith({ action: 'set_active', userId: ids.mariam, active: true });
  });

  it('saves the induction settings after checking them', async () => {
    const { api } = await openAdmin();
    const settings = screen.getByRole('region', { name: 'Settings' });
    const name = await within(settings).findByDisplayValue('Fall 2026');
    const minutes = within(settings).getByLabelText('Target interview length (minutes)');
    await userEvent.clear(minutes);
    await userEvent.type(minutes, '0');
    await userEvent.click(within(settings).getByRole('button', { name: 'Save settings' }));
    expect(within(settings).getByRole('alert')).toHaveTextContent('Target interview length must be 1 to 180 minutes');
    expect(api.updateSettings).not.toHaveBeenCalled();

    await userEvent.clear(name);
    await userEvent.type(name, 'Fall 2026 Inductions');
    await userEvent.clear(minutes);
    await userEvent.type(minutes, '20');
    await userEvent.click(within(settings).getByRole('button', { name: 'Save settings' }));
    expect(api.updateSettings).toHaveBeenCalledWith('Fall 2026 Inductions', 20);
    expect(await screen.findByText('Settings saved')).toBeInTheDocument();
  });

  it('makes a new projector link after confirming', async () => {
    const { api } = await openAdmin();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    expect(await screen.findByText('http://localhost:3000/display?key=test-key')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Make a new link' }));
    expect(window.confirm).toHaveBeenCalledWith('Make a new projector link? The current link stops working at once; open the new one on the projector.');
    expect(api.regenerateDisplayKey).toHaveBeenCalled();
    expect(await screen.findByText('http://localhost:3000/display?key=new-key')).toBeInTheDocument();
  });

  it('adds panels and deletes any panel after confirming', async () => {
    const { api } = await openAdmin();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const panels = screen.getByRole('region', { name: 'Panels' });
    await userEvent.click(await within(panels).findByRole('button', { name: '+ Add panel' }));
    expect(api.addPanel).toHaveBeenCalled();
    await userEvent.click(within(panels).getByRole('button', { name: 'Delete Panel 2' }));
    expect(api.deletePanel).toHaveBeenCalledWith('p2');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/unit/web/adminPage.test.tsx`
Expected:
FAIL: `Failed to resolve import "../../../src/admin/password.ts" from "tests/unit/web/adminPage.test.tsx". Does the file exist?`

- [ ] **Step 3: Write the admin sections**

`src/admin/password.ts`:

```ts
// Letters and digits that can't be confused when read aloud or copied by hand (no l/1, o/0, i).
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** A 12-character password for a new or reset account, from the browser's secure random source. */
export function generatePassword(length = 12): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}
```

`src/admin/AccountsSection.tsx`:

```tsx
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { validateCommand } from '../../supabase/functions/admin-users/validate.ts';
import { ROLES, type Role } from '../../supabase/functions/_shared/accounts.ts';
import { ROLE_LABELS } from '../app/homePath.ts';
import { ActionButton, buttonClasses } from '../components/ActionButton.tsx';
import { ActionProvider, useRunAction } from '../components/ActionProvider.tsx';
import { useToast } from '../components/Toasts.tsx';
import { errorMessage } from '../lib/api.ts';
import { useApi } from '../lib/ApiProvider.tsx';
import type { Account, Profile } from '../lib/types.ts';
import { generatePassword } from './password.ts';

const inputClasses = 'mt-1 block h-9 w-full rounded-md border border-slate-300 px-2 text-sm font-normal focus:border-brand-600 focus:ring-2 focus:ring-brand-100 focus:outline-none';

/** Everyone who can sign in: create, reset passwords, disable and enable (through the admin-users edge function). */
export function AccountsSection({ me }: { me: Profile }) {
  const api = useApi();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.listAccounts().then(
      (rows) => {
        setAccounts(rows);
        setError(null);
      },
      (e) => setError(errorMessage(e)),
    );
  }, [api]);
  useEffect(load, [load]);

  return (
    <section aria-labelledby="accounts-title" className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      <h2 id="accounts-title" className="font-semibold">Accounts</h2>
      <ActionProvider onSettled={load}>
        <CreateAccountForm />
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {accounts === null ? (
          !error && <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-600">
                <tr>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Username</th>
                  <th className="py-2 pr-3">Role</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {accounts.map((account) => (
                  <AccountRow key={account.id} account={account} isMe={account.id === me.id} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ActionProvider>
    </section>
  );
}

function AccountRow({ account, isMe }: { account: Account; isMe: boolean }) {
  const api = useApi();
  const run = useRunAction();
  const toast = useToast();
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const name = account.display_name;

  async function saveReset(event: FormEvent) {
    event.preventDefault();
    const parsed = validateCommand({ action: 'reset_password', userId: account.id, password });
    if (!parsed.ok) {
      setProblem(parsed.error);
      return;
    }
    const done = await run(async () => {
      await api.manageAccount(parsed.command);
      return true;
    });
    if (done) {
      toast.show(`Password reset for ${name}`, 'success');
      setResetting(false);
      setPassword('');
      setProblem(null);
    }
  }

  return (
    <tr className={account.is_active ? '' : 'text-slate-500'}>
      <td className="py-2 pr-3 font-medium">{name}</td>
      <td className="py-2 pr-3 font-mono text-xs">{account.username}</td>
      <td className="py-2 pr-3">{ROLE_LABELS[account.role]}</td>
      <td className="py-2 pr-3">{account.is_active ? 'Active' : 'Disabled'}</td>
      <td className="py-2">
        {resetting ? (
          <form noValidate className="flex flex-wrap items-center gap-2" onSubmit={(e) => void saveReset(e)}>
            <input
              aria-label={`New password for ${name}`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-8 w-40 rounded-md border border-slate-300 px-2 text-sm"
              autoFocus
            />
            <button type="button" className={buttonClasses('ghost')} onClick={() => setPassword(generatePassword())}>
              Generate
            </button>
            <button type="submit" className={buttonClasses('primary')}>
              Save
            </button>
            <button type="button" className={buttonClasses('ghost')} onClick={() => setResetting(false)}>
              Cancel
            </button>
            {problem && <span role="alert" className="text-xs text-red-700">{problem}</span>}
          </form>
        ) : (
          <div className="flex flex-wrap justify-end gap-1">
            <button type="button" className={buttonClasses('secondary')} aria-label={`Reset password for ${name}`} onClick={() => setResetting(true)}>
              Reset password
            </button>
            {!isMe &&
              (account.is_active ? (
                <ActionButton
                  variant="danger"
                  label={`Disable ${name}`}
                  confirm={`Disable ${name}? They are signed out and can't sign in until an admin enables the account again.`}
                  action={() => api.manageAccount({ action: 'set_active', userId: account.id, active: false })}
                >
                  Disable
                </ActionButton>
              ) : (
                <ActionButton label={`Enable ${name}`} action={() => api.manageAccount({ action: 'set_active', userId: account.id, active: true })}>
                  Enable
                </ActionButton>
              ))}
          </div>
        )}
      </td>
    </tr>
  );
}

/** Runs inside the section's ActionProvider, whose onSettled reloads the list. */
function CreateAccountForm() {
  const api = useApi();
  const run = useRunAction();
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Role>('panelist');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    // The same checks the edge function makes, so mistakes show up before anything is sent.
    const parsed = validateCommand({ action: 'create', username, displayName, role, password });
    if (!parsed.ok) {
      setProblem(parsed.error);
      return;
    }
    setProblem(null);
    setPending(true);
    const done = await run(async () => {
      await api.manageAccount(parsed.command);
      return true;
    });
    setPending(false);
    if (done) {
      toast.show(`Account created for ${displayName.trim()}. Give them the username and password.`, 'success');
      setUsername('');
      setDisplayName('');
      setPassword('');
    }
  }

  return (
    <form noValidate aria-labelledby="new-account-title" className="grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-5" onSubmit={(e) => void submit(e)}>
      <h3 id="new-account-title" className="text-sm font-semibold sm:col-span-5">New account</h3>
      <label className="text-sm font-medium">
        Username
        <input className={inputClasses} value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" spellCheck={false} />
      </label>
      <label className="text-sm font-medium">
        Name
        <input className={inputClasses} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </label>
      <label className="text-sm font-medium">
        Role
        <select className={inputClasses} value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      <div className="text-sm font-medium">
        <label htmlFor="new-account-password">Password</label>
        <div className="mt-1 flex gap-1">
          <input id="new-account-password" className={`${inputClasses} mt-0`} value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="button" className={buttonClasses('ghost')} onClick={() => setPassword(generatePassword())}>
            Generate
          </button>
        </div>
      </div>
      <div className="flex items-end">
        <button type="submit" className={`${buttonClasses('primary', 'md')} w-full`} disabled={pending}>
          Create account
        </button>
      </div>
      {problem && (
        <p role="alert" className="text-sm text-red-700 sm:col-span-5">
          {problem}
        </p>
      )}
    </form>
  );
}
```

`src/admin/PanelsSection.tsx`:

```tsx
import { useMemo } from 'react';
import { ActionButton } from '../components/ActionButton.tsx';
import { ActionProvider } from '../components/ActionProvider.tsx';
import { useApi } from '../lib/ApiProvider.tsx';
import { useLiveSnapshot } from '../lib/useLiveSnapshot.ts';

/** Admins can add panels and delete any panel, including Panel 1 and Panel 2. */
export function PanelsSection() {
  const api = useApi();
  const subscribe = useMemo(() => api.subscribeBoard(), [api]);
  const { data: board, error, reload } = useLiveSnapshot(api.boardSnapshot, subscribe);

  return (
    <section aria-labelledby="panels-title" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 id="panels-title" className="font-semibold">Panels</h2>
        <ActionProvider onSettled={reload}>
          <ActionButton variant="primary" action={() => api.addPanel()}>
            + Add panel
          </ActionButton>
        </ActionProvider>
      </div>
      {error && !board && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {board && (
        <ActionProvider onSettled={reload}>
          <ul className="divide-y divide-slate-100">
            {board.panels.map((panel) => (
              <li key={panel.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="font-medium">{panel.name}</span>
                <span className="text-slate-500">
                  {panel.current ? 'Busy' : 'Free'} · {panel.panelists.length} {panel.panelists.length === 1 ? 'panelist' : 'panelists'} ·{' '}
                  {panel.lane.length} lined up
                </span>
                <ActionButton
                  variant="ghost"
                  className="ml-auto"
                  label={`Delete ${panel.name}`}
                  confirm={`Delete ${panel.name}? Anyone lined up for it moves to the end of the pool.`}
                  action={() => api.deletePanel(panel.id)}
                >
                  Delete
                </ActionButton>
              </li>
            ))}
          </ul>
        </ActionProvider>
      )}
    </section>
  );
}
```

`src/admin/SettingsSection.tsx`:

```tsx
import { useEffect, useState, type FormEvent } from 'react';
import { ActionButton, buttonClasses } from '../components/ActionButton.tsx';
import { ActionProvider, useRunAction } from '../components/ActionProvider.tsx';
import { useToast } from '../components/Toasts.tsx';
import { errorMessage } from '../lib/api.ts';
import { useApi } from '../lib/ApiProvider.tsx';

const inputClasses = 'mt-1 block h-9 w-full rounded-md border border-slate-300 px-2 text-sm font-normal focus:border-brand-600 focus:ring-2 focus:ring-brand-100 focus:outline-none';

/** Same rules as update_settings(), checked before sending. */
export function settingsProblem(name: string, minutes: string): string | null {
  if (name.trim().length < 1 || name.trim().length > 80) return 'Name must be 1 to 80 characters';
  const n = Number(minutes);
  if (!Number.isInteger(n) || n < 1 || n > 180) return 'Target interview length must be 1 to 180 minutes';
  return null;
}

export function SettingsSection() {
  const api = useApi();
  const toast = useToast();
  const [name, setName] = useState('');
  const [minutes, setMinutes] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    api.induction().then(
      (induction) => {
        setName(induction.name);
        setMinutes(String(induction.target_interview_minutes));
        setLoaded(true);
      },
      (e) => setProblem(errorMessage(e)),
    );
  }, [api]);

  return (
    <section aria-labelledby="settings-title" className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h2 id="settings-title" className="font-semibold">Settings</h2>
      <ActionProvider>
        <SettingsForm
          name={name}
          minutes={minutes}
          disabled={!loaded}
          problem={problem}
          onName={setName}
          onMinutes={setMinutes}
          onProblem={setProblem}
          onSaved={() => toast.show('Settings saved', 'success')}
        />
      </ActionProvider>
    </section>
  );
}

interface SettingsFormProps {
  name: string;
  minutes: string;
  disabled: boolean;
  problem: string | null;
  onName: (value: string) => void;
  onMinutes: (value: string) => void;
  onProblem: (value: string | null) => void;
  onSaved: () => void;
}

function SettingsForm({ name, minutes, disabled, problem, onName, onMinutes, onProblem, onSaved }: SettingsFormProps) {
  const api = useApi();
  const run = useRunAction();

  async function save(event: FormEvent) {
    event.preventDefault();
    const found = settingsProblem(name, minutes);
    onProblem(found);
    if (found) return;
    const done = await run(async () => {
      await api.updateSettings(name.trim(), Number(minutes));
      return true;
    });
    if (done) onSaved();
  }

  return (
    <form noValidate className="grid gap-3 sm:grid-cols-[1fr_14rem_auto]" onSubmit={(e) => void save(e)}>
      <label className="text-sm font-medium">
        Induction name
        <input className={inputClasses} value={name} onChange={(e) => onName(e.target.value)} disabled={disabled} />
      </label>
      <label className="text-sm font-medium">
        Target interview length (minutes)
        <input className={inputClasses} type="number" min={1} max={180} value={minutes} onChange={(e) => onMinutes(e.target.value)} disabled={disabled} />
      </label>
      <div className="flex items-end">
        <button type="submit" className={buttonClasses('primary', 'md')} disabled={disabled}>
          Save settings
        </button>
      </div>
      {problem && (
        <p role="alert" className="text-sm text-red-700 sm:col-span-3">
          {problem}
        </p>
      )}
    </form>
  );
}

/** The projector's secret link: copy, open, or replace it (old links stop working). */
export function ProjectorLinkSection() {
  const api = useApi();
  const toast = useToast();
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const linkFor = (key: string) => `${window.location.origin}/display?key=${encodeURIComponent(key)}`;

  useEffect(() => {
    let active = true;
    api.getDisplayKey().then(
      (key) => active && setLink(linkFor(key)),
      (e) => active && setError(errorMessage(e)),
    );
    return () => {
      active = false;
    };
  }, [api]);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.show('Projector link copied', 'success');
    } catch {
      toast.show('Copy failed. Select the link and copy it by hand.', 'error');
    }
  }

  return (
    <section aria-labelledby="projector-title" className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
      <h2 id="projector-title" className="font-semibold">Projector link</h2>
      {link ? (
        <>
          <p className="rounded-md bg-slate-100 px-3 py-2 font-mono text-sm break-all">{link}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClasses('primary')} onClick={() => void copy(link)}>
              Copy link
            </button>
            <a className={buttonClasses('secondary')} href={link} target="_blank" rel="noreferrer">
              Open projector
            </a>
            <ActionProvider>
              <ActionButton
                variant="danger"
                confirm="Make a new projector link? The current link stops working at once; open the new one on the projector."
                action={async () => {
                  setLink(linkFor(await api.regenerateDisplayKey()));
                  toast.show('New projector link made', 'success');
                }}
              >
                Make a new link
              </ActionButton>
            </ActionProvider>
          </div>
        </>
      ) : error ? (
        <p role="alert" className="text-sm text-red-700">{error}</p>
      ) : (
        <p className="text-sm text-slate-500">Loading…</p>
      )}
      <p className="text-sm text-slate-600">Anyone with this link sees the projector screen. Share it only with whoever runs the projector.</p>
    </section>
  );
}
```

`src/admin/AdminPage.tsx`:

```tsx
import { useEffect } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider.tsx';
import { buttonClasses } from '../components/ActionButton.tsx';
import { AccountsSection } from './AccountsSection.tsx';
import { PanelsSection } from './PanelsSection.tsx';
import { ProjectorLinkSection, SettingsSection } from './SettingsSection.tsx';

const LISTS: Array<[string, string]> = [
  ['registered', 'Registered'],
  ['waiting', 'Waiting'],
  ['interviewing', 'Interviewing'],
  ['interviewed', 'Interviewed'],
  ['all', 'Everyone'],
];

/** /admin: accounts, panels, settings, the projector link and shortcuts to candidates and results. */
export function AdminPage() {
  const { state } = useAuth();

  useEffect(() => {
    document.title = 'Admin · MLSA Induction';
  }, []);

  if (state.status !== 'signed_in') return null;
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Admin</h1>
        <Link className={buttonClasses('primary', 'md')} to="/results">
          Results
        </Link>
      </div>
      <section aria-labelledby="admin-candidates-title" className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
        <h2 id="admin-candidates-title" className="font-semibold">Candidates</h2>
        <p className="text-sm text-slate-600">See everyone who registered, and where each person is on the day.</p>
        <div className="flex flex-wrap gap-2">
          {LISTS.map(([filter, label]) => (
            <Link key={filter} className={buttonClasses('secondary')} to={`/queue?list=${filter}`}>
              {label}
            </Link>
          ))}
        </div>
      </section>
      <AccountsSection me={state.profile} />
      <PanelsSection />
      <SettingsSection />
      <ProjectorLinkSection />
    </main>
  );
}
```

- [ ] **Step 4: Retire the placeholders and route `/admin`**

Replace `src/app/placeholders.tsx` with:

```tsx
import { Link, Navigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider.tsx';
import { FullPageMessage } from '../components/FullPageMessage.tsx';
import { homePath } from './homePath.ts';

export function HomeRedirect() {
  const { state } = useAuth();
  return state.status === 'signed_in' ? <Navigate to={homePath(state.profile.role)} replace /> : null;
}

export function NotFound() {
  return (
    <FullPageMessage title="Page not found">
      <Link className="font-medium text-brand-600 underline" to="/">
        Go home
      </Link>
    </FullPageMessage>
  );
}
```

Replace `src/app/routes.tsx` with:

```tsx
import type { RouteObject } from 'react-router';
import { AdminPage } from '../admin/AdminPage.tsx';
import { DisplayPage } from '../display/DisplayPage.tsx';
import { PanelPage } from '../panel/PanelPage.tsx';
import { QueuePage } from '../queue/QueuePage.tsx';
import { LoginPage } from './LoginPage.tsx';
import { HomeRedirect, NotFound } from './placeholders.tsx';
import { RequireRole } from './RequireRole.tsx';
import { RouteError } from './RouteError.tsx';
import { StaffLayout } from './StaffLayout.tsx';

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  { path: '/display', element: <DisplayPage />, errorElement: <RouteError /> },
  {
    path: '/',
    element: <StaffLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'queue', element: <RequireRole roles={['queue_manager', 'admin']}><QueuePage /></RequireRole> },
      { path: 'panel', element: <RequireRole roles={['panelist', 'admin']}><PanelPage /></RequireRole> },
      { path: 'admin', element: <RequireRole roles={['admin']}><AdminPage /></RequireRole> },
    ],
  },
  { path: '*', element: <NotFound />, errorElement: <RouteError /> },
];
```

- [ ] **Step 5: Run the tests, the type check and the build**

Run: `npm run test:unit && npm run typecheck && npm run build`
Expected:
- `Tests  152 passed (152)`
- `tsc` prints nothing.
- The build ends with `✓ built in …`.

- [ ] **Step 6: Commit**

```bash
git add src/admin src/app/placeholders.tsx src/app/routes.tsx tests/unit/web/adminPage.test.tsx
git commit -m "feat(web): admin page with accounts, panels, settings and the projector link"
```

---

### Task 9: Results, the candidate record, CSV exports and publishing

**Files:**
- Create: `src/results/resultsView.ts`, `src/results/download.ts`, `src/results/DecisionSelect.tsx`, `src/results/ResultsPage.tsx`, `src/results/CandidateRecordPage.tsx`
- Modify: `src/app/routes.tsx`, `src/app/StaffLayout.tsx`, `tests/unit/web/routing.test.tsx`
- Test: `tests/unit/web/resultsView.test.ts`, `tests/unit/web/resultsPage.test.tsx`

**Interfaces:**
- Consumes:
  - `api.resultsTable`, `api.criteria`, `api.induction`, `api.setDecision`, `api.setResultsPublished`, `api.evaluationsExport`, `api.candidateRecord`.
  - `RECOMMENDATIONS` (Task 6); `CandidateCard`, `ApplicationTabs` and `rankedPreferences` (Task 4).
- Produces:
  - Labels and formatting: `DECISION_LABELS`, `STATUS_LABELS`, `formatTally` ("1 Strong Yes · 3 Yes", or "—"), `formatAverage` (at most 2 decimals, or "—").
  - Sorting:
    - `sortRows(rows, { key, dir })`, with keys `number`, `full_name`, `evaluation_count`, `general_avg`, `decision` or `fit:<criterion>`;
    - rows without a value go last in either direction.
  - Filtering: `filterRows(rows, { status, decision, query })`. The query matches an exact number, a reg number (spaces removed, upper case) or part of the name.
  - CSV:
    - `safeCell`;
    - `candidatesCsv(rows, criteria)` (export a) and `evaluationsCsv(rows, criteria)` (export b);
    - `csvFileName(kind, inductionName, now?)`, which gives `fall-2026-candidates-2026-10-02.csv`;
    - `downloadCsv(fileName, csv)`, which adds the byte-order mark.
  - `<DecisionSelect candidateId number name decision>`, labelled "Decision for #N Name".
  - `<ResultsPage>` at `/results`: the table, the filters, sortable headers, both exports, and Publish/Unpublish with a confirmation. It reloads after every action and has a **Refresh** button.
  - `<CandidateRecordPage>` at `/results/:candidateId`: the application, every interview (panel, times, duration), the full discussion and every evaluation.
  - The staff navigation gains **Results** for admins.

- [ ] **Step 1: Write the failing tests**

`tests/unit/web/resultsView.test.ts`:

```ts
import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import type { EvaluationExportRow } from '../../../src/lib/types.ts';
import {
  candidatesCsv,
  csvFileName,
  evaluationsCsv,
  filterRows,
  formatAverage,
  formatTally,
  safeCell,
  sortRows,
} from '../../../src/results/resultsView.ts';
import { criteriaList, resultRow } from './fixtures.ts';

const rows = [
  resultRow({ candidate_id: 'c7', number: 7, full_name: 'Sara Ahmed', general_avg: 3.75, decision: 'selected', status: 'interviewed' }),
  resultRow({ candidate_id: 'c2', number: 2, full_name: 'Ali Raza', general_avg: null, evaluation_count: 0, decision: 'undecided', status: 'registered', recommendations: {} }),
  resultRow({ candidate_id: 'c9', number: 9, full_name: 'عائشہ خان', reg_number: '2025009', general_avg: 4.5, decision: 'not_selected', status: 'interviewed' }),
];

describe('formatting', () => {
  it('writes the recommendation tally strongest first, and a dash when there is none', () => {
    expect(formatTally({ yes: 3, strong_yes: 1, no: 1 })).toBe('1 Strong Yes · 3 Yes · 1 No');
    expect(formatTally({})).toBe('—');
  });

  it('shows averages to two decimals at most, and a dash for none', () => {
    expect([3.75, 4, 4.5, null].map(formatAverage)).toEqual(['3.75', '4', '4.5', '—']);
  });
});

describe('sortRows and filterRows', () => {
  it('sorts by any column, keeping candidates without scores last either way', () => {
    expect(sortRows(rows, { key: 'general_avg', dir: 'desc' }).map((r) => r.number)).toEqual([9, 7, 2]);
    expect(sortRows(rows, { key: 'general_avg', dir: 'asc' }).map((r) => r.number)).toEqual([7, 9, 2]);
    expect(sortRows(rows, { key: 'number', dir: 'asc' }).map((r) => r.number)).toEqual([2, 7, 9]);
    expect(sortRows(rows, { key: 'full_name', dir: 'asc' }).map((r) => r.number)).toEqual([2, 7, 9]);
    expect(sortRows(rows, { key: 'fit:fit_dev', dir: 'desc' }).map((r) => r.number)).toEqual([2, 7, 9]);
  });

  it('filters by status, decision and a number, name or reg number', () => {
    expect(filterRows(rows, { status: 'interviewed', decision: 'all', query: '' }).map((r) => r.number)).toEqual([7, 9]);
    expect(filterRows(rows, { status: 'all', decision: 'selected', query: '' }).map((r) => r.number)).toEqual([7]);
    expect(filterRows(rows, { status: 'all', decision: 'all', query: 'عائشہ' }).map((r) => r.number)).toEqual([9]);
    expect(filterRows(rows, { status: 'all', decision: 'all', query: '#2' }).map((r) => r.number)).toEqual([2]);
    expect(filterRows(rows, { status: 'all', decision: 'all', query: '2025009' }).map((r) => r.number)).toEqual([9]); // a reg number is all digits too
    expect(filterRows(rows, { status: 'all', decision: 'all', query: ' 2025 009 ' }).map((r) => r.number)).toEqual([9]);
  });
});

describe('CSV exports', () => {
  it('neutralises cells a spreadsheet would run as a formula', () => {
    expect(['=HYPERLINK("x")', '+92300', '-1', '@SUM(A1)', 'Ali', 3].map(safeCell)).toEqual([
      '\'=HYPERLINK("x")', "'+92300", "'-1", "'@SUM(A1)", 'Ali', '3',
    ]);
  });

  it('writes one row per candidate with averages, the tally and the decision', () => {
    const parsed = Papa.parse<string[]>(candidatesCsv(rows, criteriaList())).data;
    expect(parsed[0]).toEqual([
      'Number', 'Reg number', 'Name', 'Department', 'Batch', 'Preference 1', 'Preference 2', 'Preference 3', 'Preference 4',
      'Status', 'Evaluations', 'General average', 'Dev', 'LogiKal', 'L&D', 'Marketing', 'Strong Yes', 'Yes', 'Maybe', 'No', 'Decision',
    ]);
    expect(parsed[1]).toEqual([
      '7', '2025007', 'Sara Ahmed', 'Computer Science', 'B35', 'Dev Team', 'Marketing', '', '', 'Interviewed', '2', '3.75',
      '5', '', '', '', '1', '1', '0', '0', 'Selected',
    ]);
    expect(parsed[3][2]).toBe('عائشہ خان');
  });

  it('writes one row per evaluation with every criterion', () => {
    const exported: EvaluationExportRow[] = [{
      number: 7, reg_number: '2025007', full_name: 'Sara Ahmed', panel: 'Panel 1', panelist: 'Hamza',
      scores: { communication: 4, fit_dev: 5 }, recommendation: 'strong_yes', comments: '=cmd', submitted_at: '2026-09-26T10:07:00+00:00',
    }];
    const parsed = Papa.parse<string[]>(evaluationsCsv(exported, criteriaList())).data;
    expect(parsed[0]).toEqual([
      'Number', 'Reg number', 'Name', 'Panel', 'Panelist', 'Communication', 'Confidence & Attitude', 'Teamwork', 'Commitment',
      'Problem Solving', 'Dev', 'LogiKal', 'L&D', 'Marketing', 'Recommendation', 'Comments', 'Submitted at',
    ]);
    expect(parsed[1]).toEqual([
      '7', '2025007', 'Sara Ahmed', 'Panel 1', 'Hamza', '4', '', '', '', '', '5', '', '', '', 'Strong Yes', "'=cmd", '2026-09-26T10:07:00+00:00',
    ]);
  });

  it('names files after the induction and the date', () => {
    expect(csvFileName('candidates', 'Fall 2026 (MLSA)', new Date(2026, 8, 27))).toBe('fall-2026-mlsa-candidates-2026-09-27.csv');
  });
});
```

`tests/unit/web/resultsPage.test.tsx`:

```tsx
// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../../../src/lib/api.ts';
import { downloadCsv } from '../../../src/results/download.ts';
import { candidateRecordFor, candidateRow, profile, resultRow } from './fixtures.ts';
import { fakeApi, fakeAuth, renderApp } from './helpers.tsx';

vi.mock('../../../src/results/download.ts', () => ({ downloadCsv: vi.fn() }));

const rows = [
  resultRow({ candidate_id: 'c7', number: 7, full_name: 'Sara Ahmed', general_avg: 3.75, status: 'interviewed' }),
  resultRow({ candidate_id: 'c2', number: 2, full_name: 'Ali Raza', reg_number: '2025002', general_avg: null, evaluation_count: 0, status: 'registered', recommendations: {}, criteria_avgs: {} }),
  resultRow({ candidate_id: 'c9', number: 9, full_name: 'Bilal Khan', reg_number: '2025009', general_avg: 4.5, decision: 'selected', status: 'interviewed' }),
];

async function openResults(path = '/results', overrides: Partial<Api> = {}) {
  const api = fakeApi({ resultsTable: vi.fn(async () => rows), ...overrides });
  const view = renderApp(path, { api, auth: fakeAuth({ signedInAs: profile('admin') }).backend });
  return { ...view, api };
}

const bodyRows = () => within(screen.getByRole('table', { name: 'Results' })).getAllByRole('row').slice(1);
const numbers = () => bodyRows().map((r) => within(r).getAllByRole('cell')[0].textContent);

describe('the results page', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows every candidate with averages, team fit, the tally and the decision', async () => {
    await openResults();
    await screen.findByRole('table', { name: 'Results' });
    expect(numbers()).toEqual(['#2', '#7', '#9']);
    const sara = bodyRows()[1];
    expect(sara).toHaveTextContent('Sara Ahmed');
    expect(sara).toHaveTextContent('3.75');
    expect(sara).toHaveTextContent('1 Strong Yes · 1 Yes');
    expect(within(sara).getByRole('combobox', { name: 'Decision for #7 Sara Ahmed' })).toHaveValue('undecided');
    expect(within(sara).getByRole('link', { name: 'Sara Ahmed' })).toHaveAttribute('href', '/results/c7');
    expect(screen.getByRole('columnheader', { name: /Dev/ })).toBeInTheDocument();
  });

  it('filters by status and decision, and sorts by a column', async () => {
    await openResults();
    await screen.findByRole('table', { name: 'Results' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'interviewed');
    expect(numbers()).toEqual(['#7', '#9']);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Decision' }), 'selected');
    expect(numbers()).toEqual(['#9']);
    expect(screen.getByText('Showing 1 of 3')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Decision' }), 'all');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'all');
    await userEvent.click(screen.getByRole('button', { name: 'General avg' }));
    expect(numbers()).toEqual(['#9', '#7', '#2']); // highest first, no scores last
    expect(screen.getByRole('columnheader', { name: 'General avg' })).toHaveAttribute('aria-sort', 'descending');
  });

  it('records a decision', async () => {
    const { api } = await openResults();
    await screen.findByRole('table', { name: 'Results' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Decision for #7 Sara Ahmed' }), 'selected');
    expect(api.setDecision).toHaveBeenCalledWith('c7', 'selected');
    await waitFor(() => expect(api.resultsTable).toHaveBeenCalledTimes(2));
  });

  it('publishes after confirming, and can unpublish', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { api } = await openResults();
    await userEvent.click(await screen.findByRole('button', { name: 'Publish results' }));
    expect(window.confirm).toHaveBeenCalledWith(
      'Publish results? Everyone marked Selected appears on the public page, and panelists can no longer change their evaluations.',
    );
    expect(api.setResultsPublished).toHaveBeenCalledWith(true);

    vi.mocked(api.induction).mockResolvedValue({ id: 'ind-1', name: 'Fall 2026', target_interview_minutes: 15, results_published: true });
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Published')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the public page' })).toHaveAttribute('href', '/selected');
    await userEvent.click(screen.getByRole('button', { name: 'Unpublish' }));
    expect(api.setResultsPublished).toHaveBeenLastCalledWith(false);
  });

  it('exports both CSV files', async () => {
    const { api } = await openResults();
    await screen.findByRole('table', { name: 'Results' });
    await userEvent.click(screen.getByRole('button', { name: 'Export candidates' }));
    const [name, csv] = vi.mocked(downloadCsv).mock.calls[0];
    expect(name).toMatch(/^fall-2026-candidates-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv.split('\r\n')).toHaveLength(4); // header + 3 candidates, whatever the filters

    await userEvent.click(screen.getByRole('button', { name: 'Export evaluations' }));
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledTimes(2));
    expect(api.evaluationsExport).toHaveBeenCalled();
    expect(vi.mocked(downloadCsv).mock.calls[1][0]).toMatch(/^fall-2026-evaluations-/);
  });
});

describe('a candidate record', () => {
  it('shows the application, every interview with its discussion, and every evaluation', async () => {
    const { api } = await openResults('/results/c7', { candidateRecord: vi.fn(async () => candidateRecordFor(candidateRow())) });
    expect(await screen.findByRole('heading', { name: '#7 Sara Ahmed' })).toBeInTheDocument();
    expect(api.candidateRecord).toHaveBeenCalledWith('c7');
    expect(screen.getByRole('region', { name: 'Application' })).toBeInTheDocument();
    const interview = screen.getByRole('region', { name: 'Panel 1 interview' });
    expect(interview).toHaveTextContent('16:30');
    expect(within(interview).getByText('Strong on teamwork.')).toBeInTheDocument();
    const evaluations = within(interview).getByRole('table', { name: 'Evaluations' });
    expect(within(evaluations).getAllByRole('row')).toHaveLength(3);
    expect(evaluations).toHaveTextContent('Strong Yes');
    expect(evaluations).toHaveTextContent('Great fit.');

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Decision for #7 Sara Ahmed' }), 'not_selected');
    expect(api.setDecision).toHaveBeenCalledWith('c7', 'not_selected');
    expect(screen.getByRole('link', { name: '← All results' })).toHaveAttribute('href', '/results');
  });
});
```

In `tests/unit/web/routing.test.tsx`, change the navigation assertion in "lets an admin open every screen and sign out" to:

```tsx
    expect(nav).toHaveTextContent('QueuePanelResultsAdmin');
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/unit/web/resultsView.test.ts tests/unit/web/resultsPage.test.tsx tests/unit/web/routing.test.tsx`
Expected:
FAIL:
- `resultsView.test.ts` and `resultsPage.test.tsx` cannot load `src/results/resultsView.ts` and `src/results/download.ts`.
- `routing.test.tsx` › "lets an admin open every screen and sign out" fails at `toHaveTextContent`, because the navigation has no Results link yet.
- The other 4 routing tests pass.

- [ ] **Step 3: Write the results helpers**

`src/results/resultsView.ts`:

```ts
// Pure helpers behind /results: formatting, sorting, filtering and the two CSV exports.
import Papa from 'papaparse';
import type { CandidateStatus, Criterion, Decision, EvaluationExportRow, Recommendation, ResultRow } from '../lib/types.ts';
import { RECOMMENDATIONS } from '../panel/evaluation.ts';

export const DECISION_LABELS: Record<Decision, string> = {
  undecided: 'Undecided',
  selected: 'Selected',
  not_selected: 'Not selected',
};

export const STATUS_LABELS: Record<CandidateStatus, string> = {
  registered: 'Registered',
  waiting: 'Waiting',
  interviewing: 'Interviewing',
  interviewed: 'Interviewed',
};

const RECOMMENDATION_LABELS = Object.fromEntries(RECOMMENDATIONS.map((r) => [r.value, r.label])) as Record<Recommendation, string>;

/** "1 Strong Yes · 3 Yes", strongest first; "—" when nobody has evaluated. */
export function formatTally(recommendations: ResultRow['recommendations']): string {
  const parts = RECOMMENDATIONS.filter((r) => recommendations[r.value]).map((r) => `${recommendations[r.value]} ${r.label}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

export function formatAverage(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : String(Number(value.toFixed(2)));
}

export type SortKey = 'number' | 'full_name' | 'evaluation_count' | 'general_avg' | 'decision' | `fit:${string}`;

export interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

function sortValue(row: ResultRow, key: SortKey): number | string | null {
  if (key.startsWith('fit:')) return row.criteria_avgs[key.slice(4)] ?? null;
  if (key === 'full_name') return row.full_name.toLocaleLowerCase();
  if (key === 'decision') return DECISION_LABELS[row.decision];
  return row[key as 'number' | 'evaluation_count' | 'general_avg'];
}

/** Sorted by one column; rows without a value (no scores yet) always go last; ties by number. */
export function sortRows(rows: ResultRow[], sort: SortState): ResultRow[] {
  const direction = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = sortValue(a, sort.key);
    const y = sortValue(b, sort.key);
    if (x === null || y === null) return x === y ? a.number - b.number : x === null ? 1 : -1;
    if (x < y) return -direction;
    if (x > y) return direction;
    return a.number - b.number;
  });
}

export interface Filters {
  status: CandidateStatus | 'all';
  decision: Decision | 'all';
  query: string;
}

export function filterRows(rows: ResultRow[], { status, decision, query }: Filters): ResultRow[] {
  const q = query.trim();
  const exactNumber = /^#?\d+$/.test(q) ? Number(q.replace('#', '')) : null;
  const reg = q.replace(/\s+/g, '').toUpperCase();
  const name = q.toLocaleLowerCase();
  return rows.filter(
    (row) =>
      (status === 'all' || row.status === status) &&
      (decision === 'all' || row.decision === decision) &&
      (!q || row.number === exactNumber || row.reg_number.includes(reg) || row.full_name.toLocaleLowerCase().includes(name)),
  );
}

/** Spreadsheets run cells starting with = + - @ as formulas; names and comments come from the public form. */
export function safeCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

const teamFit = (criteria: Criterion[]) => criteria.filter((c) => c.category === 'team_fit');

/** Export (a): one row per candidate with the summary and the decision. */
export function candidatesCsv(rows: ResultRow[], criteria: Criterion[]): string {
  const fit = teamFit(criteria);
  const header = [
    'Number', 'Reg number', 'Name', 'Department', 'Batch', 'Preference 1', 'Preference 2', 'Preference 3', 'Preference 4',
    'Status', 'Evaluations', 'General average', ...fit.map((c) => c.label), ...RECOMMENDATIONS.map((r) => r.label), 'Decision',
  ];
  const body = rows.map((row) => [
    row.number,
    row.reg_number,
    row.full_name,
    row.department,
    row.batch,
    ...[0, 1, 2, 3].map((i) => row.preferences[i] ?? ''),
    STATUS_LABELS[row.status],
    row.evaluation_count,
    row.general_avg === null ? '' : formatAverage(row.general_avg),
    ...fit.map((c) => (row.criteria_avgs[c.key] === undefined ? '' : formatAverage(row.criteria_avgs[c.key]))),
    ...RECOMMENDATIONS.map((r) => row.recommendations[r.value] ?? 0),
    DECISION_LABELS[row.decision],
  ]);
  return Papa.unparse([header, ...body].map((line) => line.map(safeCell)));
}

/** Export (b): one row per evaluation, with every criterion as a column. */
export function evaluationsCsv(rows: EvaluationExportRow[], criteria: Criterion[]): string {
  const header = ['Number', 'Reg number', 'Name', 'Panel', 'Panelist', ...criteria.map((c) => c.label), 'Recommendation', 'Comments', 'Submitted at'];
  const body = rows.map((row) => [
    row.number,
    row.reg_number,
    row.full_name,
    row.panel,
    row.panelist,
    ...criteria.map((c) => row.scores[c.key] ?? ''),
    RECOMMENDATION_LABELS[row.recommendation],
    row.comments,
    row.submitted_at,
  ]);
  return Papa.unparse([header, ...body].map((line) => line.map(safeCell)));
}

export function csvFileName(kind: 'candidates' | 'evaluations', inductionName: string, now = new Date()): string {
  const slug = inductionName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'induction';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${slug}-${kind}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.csv`;
}
```

`src/results/download.ts`:

```ts
/** Saves a CSV in the browser. The byte-order mark makes Excel read Urdu names as UTF-8. */
export function downloadCsv(fileName: string, csv: string): void {
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

- [ ] **Step 4: Write the screens**

`src/results/DecisionSelect.tsx`:

```tsx
import { useState } from 'react';
import { useRunAction } from '../components/ActionProvider.tsx';
import { useApi } from '../lib/ApiProvider.tsx';
import type { Decision } from '../lib/types.ts';
import { DECISION_LABELS } from './resultsView.ts';

interface DecisionSelectProps {
  candidateId: string;
  number: number;
  name: string;
  decision: Decision;
}

/** Undecided / Selected / Not selected. Shows the choice at once; the reload that follows confirms it. */
export function DecisionSelect({ candidateId, number, name, decision }: DecisionSelectProps) {
  const api = useApi();
  const run = useRunAction();
  const [chosen, setChosen] = useState<Decision | null>(null);
  const [pending, setPending] = useState(false);
  const value = pending && chosen ? chosen : decision;

  async function change(next: Decision) {
    setChosen(next);
    setPending(true);
    await run(() => api.setDecision(candidateId, next));
    setPending(false);
  }

  return (
    <select
      aria-label={`Decision for #${number} ${name}`}
      value={value}
      disabled={pending}
      onChange={(e) => void change(e.target.value as Decision)}
      className={`h-8 rounded-md border px-2 text-sm ${
        value === 'selected' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : value === 'not_selected' ? 'border-slate-300 bg-slate-100' : 'border-slate-300 bg-white'
      }`}
    >
      {(Object.keys(DECISION_LABELS) as Decision[]).map((d) => (
        <option key={d} value={d}>
          {DECISION_LABELS[d]}
        </option>
      ))}
    </select>
  );
}
```

`src/results/ResultsPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ActionButton, buttonClasses } from '../components/ActionButton.tsx';
import { ActionProvider, useRunAction } from '../components/ActionProvider.tsx';
import { FullPageMessage } from '../components/FullPageMessage.tsx';
import { errorMessage } from '../lib/api.ts';
import { useApi } from '../lib/ApiProvider.tsx';
import type { CandidateStatus, Criterion, Decision, InductionSettings, ResultRow } from '../lib/types.ts';
import { rankedPreferences } from '../panel/applicationView.ts';
import { DecisionSelect } from './DecisionSelect.tsx';
import { downloadCsv } from './download.ts';
import {
  candidatesCsv,
  csvFileName,
  DECISION_LABELS,
  evaluationsCsv,
  filterRows,
  formatAverage,
  formatTally,
  sortRows,
  STATUS_LABELS,
  type Filters,
  type SortKey,
  type SortState,
} from './resultsView.ts';

/** /results: every candidate's evaluations summed up, decisions, exports and publishing (admins). */
export function ResultsPage() {
  const api = useApi();
  const [rows, setRows] = useState<ResultRow[] | null>(null);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [induction, setInduction] = useState<InductionSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({ status: 'all', decision: 'all', query: '' });
  const [sort, setSort] = useState<SortState>({ key: 'number', dir: 'asc' });

  const load = useCallback(async () => {
    try {
      const [table, settings] = await Promise.all([api.resultsTable(), api.induction()]);
      setRows(table);
      setInduction(settings);
      setError(null);
      setCriteria(await api.criteria(settings.id));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [api]);

  useEffect(() => {
    document.title = 'Results · MLSA Induction';
    void load();
  }, [load]);

  if (!rows || !induction) {
    return (
      <FullPageMessage title={error ? "Couldn't load the results" : 'Loading the results…'}>
        {error && (
          <>
            <p>{error}</p>
            <button type="button" className={`${buttonClasses('secondary', 'md')} mt-3`} onClick={() => void load()}>
              Try again
            </button>
          </>
        )}
      </FullPageMessage>
    );
  }

  const fit = criteria.filter((c) => c.category === 'team_fit');
  const shown = sortRows(filterRows(rows, filters), sort);
  const decided = (d: Decision) => rows.filter((r) => r.decision === d).length;
  const sortBy = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'number' || key === 'full_name' ? 'asc' : 'desc' }));

  return (
    <ActionProvider onSettled={() => void load()}>
      <main className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">Results · {induction.name}</h1>
          <span className="text-sm text-slate-600">
            {decided('selected')} selected · {decided('not_selected')} not selected · {decided('undecided')} undecided
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" className={buttonClasses('ghost', 'md')} onClick={() => void load()}>
              Refresh
            </button>
            <ExportButtons rows={rows} criteria={criteria} inductionName={induction.name} />
            <PublishControl published={induction.results_published} />
          </div>
        </div>
        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
            Couldn't refresh: {error}
          </p>
        )}

        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="font-medium">
            Status
            <select
              className="mt-1 block h-9 rounded-md border border-slate-300 bg-white px-2"
              value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as CandidateStatus | 'all' }))}
            >
              <option value="all">All</option>
              {(Object.keys(STATUS_LABELS) as CandidateStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="font-medium">
            Decision
            <select
              className="mt-1 block h-9 rounded-md border border-slate-300 bg-white px-2"
              value={filters.decision}
              onChange={(e) => setFilters((f) => ({ ...f, decision: e.target.value as Decision | 'all' }))}
            >
              <option value="all">All</option>
              {(Object.keys(DECISION_LABELS) as Decision[]).map((d) => (
                <option key={d} value={d}>
                  {DECISION_LABELS[d]}
                </option>
              ))}
            </select>
          </label>
          <label className="font-medium">
            Find
            <input
              type="search"
              className="mt-1 block h-9 w-64 rounded-md border border-slate-300 px-2 font-normal"
              placeholder="Number, name or reg number"
              value={filters.query}
              onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
            />
          </label>
          <span className="pb-2 text-slate-500">
            Showing {shown.length} of {rows.length}
          </span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table aria-label="Results" className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600 [&_th]:font-medium">
              <tr>
                <SortHeader label="#" sortKey="number" sort={sort} onSort={sortBy} />
                <SortHeader label="Name" sortKey="full_name" sort={sort} onSort={sortBy} />
                <th className="px-3 py-2">Preferences</th>
                <th className="px-3 py-2">Status</th>
                <SortHeader label="Evals" sortKey="evaluation_count" sort={sort} onSort={sortBy} />
                <SortHeader label="General avg" sortKey="general_avg" sort={sort} onSort={sortBy} />
                {fit.map((c) => (
                  <SortHeader key={c.key} label={c.label} sortKey={`fit:${c.key}`} sort={sort} onSort={sortBy} />
                ))}
                <th className="px-3 py-2">Recommendations</th>
                <SortHeader label="Decision" sortKey="decision" sort={sort} onSort={sortBy} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((row) => (
                <tr key={row.candidate_id}>
                  <td className="px-3 py-2 tabular-nums">#{row.number}</td>
                  <td className="px-3 py-2">
                    <Link className="font-medium text-brand-700 hover:underline" to={`/results/${row.candidate_id}`}>
                      <bdi>{row.full_name}</bdi>
                    </Link>
                    <div className="text-xs text-slate-500">{row.reg_number}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {rankedPreferences(row.preferences).map((p) => `${p.rank}. ${p.team}`).join(' · ')}
                  </td>
                  <td className="px-3 py-2">{STATUS_LABELS[row.status]}</td>
                  <td className="px-3 py-2 tabular-nums">{row.evaluation_count}</td>
                  <td className="px-3 py-2 font-medium tabular-nums">{formatAverage(row.general_avg)}</td>
                  {fit.map((c) => (
                    <td key={c.key} className="px-3 py-2 tabular-nums">
                      {formatAverage(row.criteria_avgs[c.key])}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-xs">{formatTally(row.recommendations)}</td>
                  <td className="px-3 py-2">
                    <DecisionSelect candidateId={row.candidate_id} number={row.number} name={row.full_name} decision={row.decision} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </ActionProvider>
  );
}

function SortHeader({ label, sortKey, sort, onSort }: { label: string; sortKey: SortKey; sort: SortState; onSort: (key: SortKey) => void }) {
  const active = sort.key === sortKey;
  return (
    <th className="px-3 py-2" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="font-medium hover:text-slate-900" onClick={() => onSort(sortKey)}>
        {label}
        {active && <span aria-hidden="true">{sort.dir === 'asc' ? ' ▲' : ' ▼'}</span>}
      </button>
    </th>
  );
}

function ExportButtons({ rows, criteria, inductionName }: { rows: ResultRow[]; criteria: Criterion[]; inductionName: string }) {
  const api = useApi();
  const run = useRunAction();
  return (
    <>
      <button
        type="button"
        className={buttonClasses('secondary', 'md')}
        onClick={() => downloadCsv(csvFileName('candidates', inductionName), candidatesCsv(rows, criteria))}
      >
        Export candidates
      </button>
      <button
        type="button"
        className={buttonClasses('secondary', 'md')}
        onClick={() =>
          void run(async () => downloadCsv(csvFileName('evaluations', inductionName), evaluationsCsv(await api.evaluationsExport(), criteria)))
        }
      >
        Export evaluations
      </button>
    </>
  );
}

function PublishControl({ published }: { published: boolean }) {
  const api = useApi();
  if (!published) {
    return (
      <ActionButton
        variant="primary"
        size="md"
        confirm="Publish results? Everyone marked Selected appears on the public page, and panelists can no longer change their evaluations."
        action={() => api.setResultsPublished(true)}
      >
        Publish results
      </ActionButton>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-sm font-semibold text-emerald-800">Published</span>
      <Link className={buttonClasses('ghost', 'md')} to="/selected" target="_blank">
        Open the public page
      </Link>
      <ActionButton
        size="md"
        confirm="Unpublish results? The public page goes back to “Results not announced yet”, and panelists can edit evaluations again."
        action={() => api.setResultsPublished(false)}
      >
        Unpublish
      </ActionButton>
    </span>
  );
}
```

`src/results/CandidateRecordPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { buttonClasses } from '../components/ActionButton.tsx';
import { ActionProvider } from '../components/ActionProvider.tsx';
import { FullPageMessage } from '../components/FullPageMessage.tsx';
import { errorMessage } from '../lib/api.ts';
import { useApi } from '../lib/ApiProvider.tsx';
import { formatElapsed, parseServerTime } from '../lib/clock.ts';
import type { CandidateRecord, Criterion, RecordInterview } from '../lib/types.ts';
import { ApplicationTabs } from '../panel/ApplicationTabs.tsx';
import { CandidateCard } from '../panel/CandidateCard.tsx';
import { RECOMMENDATIONS } from '../panel/evaluation.ts';
import { DecisionSelect } from './DecisionSelect.tsx';

const clock = (iso: string) => new Date(parseServerTime(iso)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const recommendationLabel = (value: string) => RECOMMENDATIONS.find((r) => r.value === value)?.label ?? value;

/** /results/:candidateId: answers, every interview (panel, times, duration), chats and evaluations. */
export function CandidateRecordPage() {
  const api = useApi();
  const { candidateId = '' } = useParams();
  const [record, setRecord] = useState<CandidateRecord | null>(null);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRecord(await api.candidateRecord(candidateId));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [api, candidateId]);

  useEffect(() => {
    void load();
    api.induction().then((i) => api.criteria(i.id)).then(setCriteria, () => {});
  }, [api, load]);

  useEffect(() => {
    if (record) document.title = `#${record.candidate.number} ${record.candidate.full_name} · Results`;
  }, [record]);

  if (!record) {
    return (
      <FullPageMessage title={error ? "Couldn't load this candidate" : 'Loading…'}>
        {error && <p>{error}</p>}
        <Link className={`${buttonClasses('secondary', 'md')} mt-3`} to="/results">
          ← All results
        </Link>
      </FullPageMessage>
    );
  }

  const { candidate, interviews } = record;
  return (
    <ActionProvider onSettled={() => void load()}>
      <main className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link className="text-sm font-medium text-brand-700 hover:underline" to="/results">
            ← All results
          </Link>
          <label className="flex items-center gap-2 text-sm font-medium">
            Decision
            <DecisionSelect candidateId={candidate.id} number={candidate.number} name={candidate.full_name} decision={candidate.decision} />
          </label>
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="space-y-4">
            <CandidateCard candidate={candidate} targetMinutes={0} />
            <ApplicationTabs candidate={candidate} />
          </div>
          <div className="space-y-4">
            {interviews.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-600">No interviews yet.</p>
            ) : (
              interviews.map((interview) => <InterviewRecord key={interview.id} interview={interview} criteria={criteria} />)
            )}
          </div>
        </div>
      </main>
    </ActionProvider>
  );
}

function InterviewRecord({ interview, criteria }: { interview: RecordInterview; criteria: Criterion[] }) {
  const timing =
    interview.status === 'cancelled'
      ? 'Cancelled (sent back to the queue)'
      : interview.ended_at
        ? `${clock(interview.started_at)}–${clock(interview.ended_at)} · ${formatElapsed(parseServerTime(interview.ended_at) - parseServerTime(interview.started_at))}`
        : `${clock(interview.started_at)} · in progress`;

  return (
    <section aria-label={`${interview.panel_name} interview`} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">
        {interview.panel_name} <span className="font-normal text-slate-600">· {timing}</span>
      </h2>
      {interview.evaluations.length === 0 ? (
        <p className="text-sm text-slate-500">No evaluations.</p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label="Evaluations" className="w-full text-left text-xs">
            <thead className="text-slate-600">
              <tr>
                <th className="py-1 pr-2">Panelist</th>
                {criteria.map((c) => (
                  <th key={c.key} className="py-1 pr-2" title={c.label}>
                    {c.label}
                  </th>
                ))}
                <th className="py-1 pr-2">Recommendation</th>
                <th className="py-1">Comments</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {interview.evaluations.map((e) => (
                <tr key={e.panelist_name}>
                  <td className="py-1 pr-2 font-medium">{e.panelist_name}</td>
                  {criteria.map((c) => (
                    <td key={c.key} className="py-1 pr-2 tabular-nums">
                      {e.scores[c.key] ?? '—'}
                    </td>
                  ))}
                  <td className="py-1 pr-2">{recommendationLabel(e.recommendation)}</td>
                  <td dir="auto" className="py-1 whitespace-pre-wrap">
                    {e.comments}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div>
        <h3 className="text-sm font-semibold">Discussion</h3>
        {interview.messages.length === 0 ? (
          <p className="text-sm text-slate-500">No messages.</p>
        ) : (
          <ol className="mt-1 space-y-1 text-sm">
            {interview.messages.map((m) => (
              <li key={m.id}>
                <span className="font-medium">{m.author_name}</span> <span className="text-xs text-slate-500">{clock(m.created_at)}</span>
                <p dir="auto" className="whitespace-pre-wrap">
                  {m.body}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Route them and add Results to the navigation**

Replace `src/app/routes.tsx` with:

```tsx
import type { RouteObject } from 'react-router';
import { AdminPage } from '../admin/AdminPage.tsx';
import { DisplayPage } from '../display/DisplayPage.tsx';
import { PanelPage } from '../panel/PanelPage.tsx';
import { CandidateRecordPage } from '../results/CandidateRecordPage.tsx';
import { ResultsPage } from '../results/ResultsPage.tsx';
import { QueuePage } from '../queue/QueuePage.tsx';
import { LoginPage } from './LoginPage.tsx';
import { HomeRedirect, NotFound } from './placeholders.tsx';
import { RequireRole } from './RequireRole.tsx';
import { RouteError } from './RouteError.tsx';
import { StaffLayout } from './StaffLayout.tsx';

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  { path: '/display', element: <DisplayPage />, errorElement: <RouteError /> },
  {
    path: '/',
    element: <StaffLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'queue', element: <RequireRole roles={['queue_manager', 'admin']}><QueuePage /></RequireRole> },
      { path: 'panel', element: <RequireRole roles={['panelist', 'admin']}><PanelPage /></RequireRole> },
      { path: 'admin', element: <RequireRole roles={['admin']}><AdminPage /></RequireRole> },
      { path: 'results', element: <RequireRole roles={['admin']}><ResultsPage /></RequireRole> },
      { path: 'results/:candidateId', element: <RequireRole roles={['admin']}><CandidateRecordPage /></RequireRole> },
    ],
  },
  { path: '*', element: <NotFound />, errorElement: <RouteError /> },
];
```

In `src/app/StaffLayout.tsx`, add the Results entry to `NAV`, between Panel and Admin:

```tsx
  { to: '/results', label: 'Results', roles: ['admin'] },
```

- [ ] **Step 6: Run the tests, the type check and the build**

Run: `npm run test:unit && npm run typecheck && npm run build`
Expected:
- `Tests  166 passed (166)`
- `tsc` prints nothing.
- The build ends with `✓ built in …`.

- [ ] **Step 7: Commit**

```bash
git add src/results src/app/routes.tsx src/app/StaffLayout.tsx tests/unit/web/resultsView.test.ts tests/unit/web/resultsPage.test.tsx tests/unit/web/routing.test.tsx
git commit -m "feat(web): results, candidate record, CSV exports and publishing"
```

---

### Task 10: The public list of selected candidates

**Files:**
- Create: `src/public/SelectedPage.tsx`
- Modify: `src/app/routes.tsx`
- Test: `tests/unit/web/selectedPage.test.tsx`

**Interfaces:**
- Consumes: `api.publishedResults()`, which returns an empty list until an admin publishes and then gives the selected candidates sorted by name.
- Produces:
  - `matchesResult(result, query)`: matches part of the name in any case or script, or the reg number with spaces removed and in upper case.
  - `<SelectedPage>` at `/selected`, with no login:
    - Before publishing (or with nobody selected) it says "Results not announced yet".
    - Once published it lists everyone selected with a "Find your name or reg number" box and "N candidate(s) selected".
    - A failed load offers **Try again**.

- [ ] **Step 1: Write the failing tests**

`tests/unit/web/selectedPage.test.tsx`:

```tsx
// @vitest-environment jsdom
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/lib/api.ts';
import { fakeApi, renderApp } from './helpers.tsx';

const selected = [
  { full_name: 'Ali Raza', reg_number: '2025101' },
  { full_name: "Zara O'Brien-Khan", reg_number: '2025103' },
  { full_name: 'عائشہ خان', reg_number: '2025102' },
];

describe('the public results page', () => {
  it('lists the selected candidates once results are published, without a login', async () => {
    renderApp('/selected', { api: fakeApi({ publishedResults: vi.fn(async () => selected) }) });
    const list = await screen.findByRole('list', { name: 'Selected candidates' });
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Ali Raza2025101', "Zara O'Brien-Khan2025103", 'عائشہ خان2025102',
    ]);
    expect(screen.getByText('3 candidates selected')).toBeInTheDocument();
    expect(document.title).toBe('Induction results · Microsoft Club GIKI');
  });

  it('finds your name or reg number, however it is typed', async () => {
    renderApp('/selected', { api: fakeApi({ publishedResults: vi.fn(async () => selected) }) });
    const find = await screen.findByRole('searchbox', { name: 'Find your name or reg number' });
    await userEvent.type(find, ' 2025 102 ');
    expect(within(screen.getByRole('list', { name: 'Selected candidates' })).getAllByRole('listitem')).toHaveLength(1);
    await userEvent.clear(find);
    await userEvent.type(find, 'nobody');
    expect(screen.getByText('No selected candidate matches “nobody”. Check the spelling, or search by reg number.')).toBeInTheDocument();
  });

  it('counts one selected candidate in the singular', async () => {
    renderApp('/selected', { api: fakeApi({ publishedResults: vi.fn(async () => selected.slice(0, 1)) }) });
    expect(await screen.findByText('1 candidate selected')).toBeInTheDocument();
  });

  it('says results are not announced yet before publishing', async () => {
    renderApp('/selected', { api: fakeApi({ publishedResults: vi.fn(async () => []) }) });
    expect(await screen.findByRole('heading', { name: 'Results not announced yet' })).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('offers to try again when the results cannot be loaded', async () => {
    const publishedResults = vi.fn().mockRejectedValueOnce(new ApiError("Can't reach the server.")).mockResolvedValue(selected);
    renderApp('/selected', { api: fakeApi({ publishedResults }) });
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('list', { name: 'Selected candidates' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/unit/web/selectedPage.test.tsx`
Expected:
FAIL: all 5 tests fail, because `/selected` is still "Page not found". For example: `Unable to find role="heading" and name "Results not announced yet"`.

- [ ] **Step 3: Write the page and route it**

`src/public/SelectedPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { buttonClasses } from '../components/ActionButton.tsx';
import { useApi } from '../lib/ApiProvider.tsx';
import type { PublishedResult } from '../lib/types.ts';

/** Case, spaces and script don't matter: " 2025 102 " finds 2025102, "ali" finds Ali. */
export function matchesResult(result: PublishedResult, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  return result.reg_number.includes(q.replace(/\s+/g, '').toUpperCase()) || result.full_name.toLocaleLowerCase().includes(q.toLocaleLowerCase());
}

/** /selected: the public list of selected candidates, shown only after an admin publishes results. */
export function SelectedPage() {
  const api = useApi();
  const [results, setResults] = useState<PublishedResult[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(() => {
    setFailed(false);
    api.publishedResults().then(setResults, () => setFailed(true));
  }, [api]);

  useEffect(() => {
    document.title = 'Induction results · Microsoft Club GIKI';
    load();
  }, [load]);

  const shown = (results ?? []).filter((r) => matchesResult(r, query));

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 to-white">
      <main className="mx-auto max-w-2xl space-y-6 px-4 py-12">
        <header className="space-y-1 text-center">
          <p className="text-sm font-semibold tracking-wide text-brand-600 uppercase">Microsoft Club GIKI</p>
          {results && results.length > 0 && <h1 className="text-3xl font-bold">Induction results</h1>}
        </header>

        {failed ? (
          <div className="space-y-3 text-center">
            <p className="text-slate-700">Couldn't load the results. Check your connection and try again.</p>
            <button type="button" className={buttonClasses('primary', 'md')} onClick={load}>
              Try again
            </button>
          </div>
        ) : results === null ? (
          <p className="text-center text-slate-500">Loading…</p>
        ) : results.length === 0 ? (
          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-bold">Results not announced yet</h1>
            <p className="text-slate-600">Check back after the announcement.</p>
          </div>
        ) : (
          <>
            <p className="text-center text-slate-700">
              Congratulations to everyone selected!{' '}
              <span className="font-medium">
                {results.length} {results.length === 1 ? 'candidate' : 'candidates'} selected
              </span>
            </p>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find your name or reg number"
              aria-label="Find your name or reg number"
              className="h-11 w-full rounded-lg border border-slate-300 bg-white px-4 focus:border-brand-600 focus:ring-2 focus:ring-brand-100 focus:outline-none"
            />
            {shown.length === 0 ? (
              <p className="text-center text-slate-600">
                No selected candidate matches “{query.trim()}”. Check the spelling, or search by reg number.
              </p>
            ) : (
              <ul aria-label="Selected candidates" className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
                {shown.map((r) => (
                  <li key={r.reg_number} className="flex items-baseline justify-between gap-3 px-4 py-3">
                    <bdi className="font-medium">{r.full_name}</bdi>
                    <span className="font-mono text-sm text-slate-500">{r.reg_number}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  );
}
```

Replace `src/app/routes.tsx` with:

```tsx
import type { RouteObject } from 'react-router';
import { AdminPage } from '../admin/AdminPage.tsx';
import { DisplayPage } from '../display/DisplayPage.tsx';
import { PanelPage } from '../panel/PanelPage.tsx';
import { SelectedPage } from '../public/SelectedPage.tsx';
import { CandidateRecordPage } from '../results/CandidateRecordPage.tsx';
import { ResultsPage } from '../results/ResultsPage.tsx';
import { QueuePage } from '../queue/QueuePage.tsx';
import { LoginPage } from './LoginPage.tsx';
import { HomeRedirect, NotFound } from './placeholders.tsx';
import { RequireRole } from './RequireRole.tsx';
import { RouteError } from './RouteError.tsx';
import { StaffLayout } from './StaffLayout.tsx';

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  { path: '/display', element: <DisplayPage />, errorElement: <RouteError /> },
  { path: '/selected', element: <SelectedPage />, errorElement: <RouteError /> },
  {
    path: '/',
    element: <StaffLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'queue', element: <RequireRole roles={['queue_manager', 'admin']}><QueuePage /></RequireRole> },
      { path: 'panel', element: <RequireRole roles={['panelist', 'admin']}><PanelPage /></RequireRole> },
      { path: 'admin', element: <RequireRole roles={['admin']}><AdminPage /></RequireRole> },
      { path: 'results', element: <RequireRole roles={['admin']}><ResultsPage /></RequireRole> },
      { path: 'results/:candidateId', element: <RequireRole roles={['admin']}><CandidateRecordPage /></RequireRole> },
    ],
  },
  { path: '*', element: <NotFound />, errorElement: <RouteError /> },
];
```

- [ ] **Step 4: Run the tests, the type check and the build**

Run: `npm run test:unit && npm run typecheck && npm run build`
Expected:
- `Tests  171 passed (171)`
- `tsc` prints nothing.
- The build ends with `✓ built in …`.

- [ ] **Step 5: Commit**

```bash
git add src/public/SelectedPage.tsx src/app/routes.tsx tests/unit/web/selectedPage.test.tsx
git commit -m "feat(web): public list of selected candidates"
```

---

### Task 11: Induction day end to end in real browsers

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/induction-day.spec.ts`
- Modify: `package.json` (dev dependency and script), `.gitignore`

**Interfaces:**
- Consumes:
  - Every screen above.
  - The dev accounts from `npm run seed:dev`, and `fixtures/form-export-fake.csv`.
  - `localEnv()` (Plan 1), `usernameToEmail()`, `createApi()` (used for clean-up).
- Produces:
  - The npm script `test:e2e`.
  - A single test that walks the spec §12 path:
    - import, check in, line up and send in, with the projector updating;
    - two panelists chat, the interview ends, and both evaluate;
    - results, a decision, publishing, and `/selected` showing the candidate.
  - Before it finishes, the test undoes what it did: unpublish, undecide, leave the panel, end the interview and delete its own panel.

- [ ] **Step 1: Install Playwright's test runner**

```bash
npm install -D @playwright/test@1.63.0
```

Expected: `added … packages` and `found 0 vulnerabilities`.

Playwright 1.63.0 uses Chromium build 1243. Check that it is already cached: `ls ~/.cache/ms-playwright/chromium-1243`. If it is not, stop and ask before running `npx playwright install chromium` (the disk is nearly full).

- [ ] **Step 2: Add the script and ignore Playwright's output**

In `package.json`, add this to `"scripts"`, after `test:integration`:

```json
    "test:e2e": "playwright test",
```

Append to `.gitignore`:

```gitignore
test-results/
playwright-report/
```

- [ ] **Step 3: Configure Playwright**

`playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

// End-to-end tests drive real browsers against the dev server and the local Supabase stack.
// Before running: npm run db:start, npm run seed:dev, npm run functions:serve (see readme).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
```

Vitest's `include` pattern is `tests/**/*.test.{ts,tsx}`, so it never picks up `*.spec.ts`. `tsconfig.json` does not include `tests/e2e`, because Playwright compiles its own tests.

- [ ] **Step 4: Write the end-to-end test**

`tests/e2e/induction-day.spec.ts`:

```ts
// The whole day in real browsers (spec §12): import → check in → line up → send in (projector
// updates) → two panelists chat → end → both evaluate → results → decide → publish → /selected.
// Uses the dev accounts from `npm run seed:dev` and a fresh candidate and panel of its own.
import { expect, test, type Browser, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
import Papa from 'papaparse';
import { localEnv } from '../../scripts/lib/local-env.ts';
import { usernameToEmail } from '../../supabase/functions/_shared/accounts.ts';
import { createApi } from '../../src/lib/api.ts';

const PASSWORD = 'induction-dev';
const stamp = String(Date.now()).slice(-6);
const candidateName = `Eesha Test ${stamp}`;
const reg = `E2E${stamp}`;
let panelName: string | undefined; // the panel this test adds, removed again afterwards

/** The fake export's header plus one fresh response, written where the file picker can find it. */
function writeExport(path: string): void {
  const [header, first] = Papa.parse<string[]>(readFileSync('fixtures/form-export-fake.csv', 'utf8'), { skipEmptyLines: 'greedy' }).data;
  const row = [...first];
  row[0] = '9/26/2026 12:00:00';
  row[2] = candidateName;
  row[4] = reg;
  writeFileSync(path, Papa.unparse([header, row], { newline: '\r\n' }));
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

async function evaluate(page: Page, recommendation: string, communication: string): Promise<void> {
  const form = page.getByRole('region', { name: 'My evaluation' });
  await form.getByRole('group', { name: 'Communication' }).getByRole('radio', { name: communication, exact: true }).check({ force: true });
  await form.getByRole('group', { name: 'Overall recommendation' }).getByRole('radio', { name: recommendation, exact: true }).check({ force: true });
  await form.getByRole('button', { name: 'Submit evaluation' }).click();
  await expect(page.getByText('Evaluation submitted')).toBeVisible();
}

test('an induction day from import to the published list', async ({ browser }, testInfo) => {
  const csvPath = testInfo.outputPath('responses.csv');
  writeExport(csvPath);

  // Queue manager: import, add a panel of our own, check the candidate in and line them up.
  const qm = await signIn(browser, 'queue', '/queue');
  await qm.getByRole('button', { name: 'Import CSV' }).click();
  await qm.getByLabel('CSV file').setInputFiles(csvPath);
  await qm.getByRole('button', { name: 'Import 1 response' }).click();
  await expect(qm.getByText('Added 1 · Updated 0')).toBeVisible();
  await qm.getByRole('button', { name: 'Done' }).click();

  const panelsBefore = await qm.getByRole('region', { name: /^Panel \d+$/ }).count();
  await qm.getByRole('button', { name: '+ Add panel' }).click();
  await expect(qm.getByRole('region', { name: /^Panel \d+$/ })).toHaveCount(panelsBefore + 1);
  panelName = (await qm.getByRole('region', { name: /^Panel \d+$/ }).last().getAttribute('aria-label'))!;

  await qm.getByRole('searchbox', { name: 'Search candidates' }).fill(reg);
  const result = qm.getByRole('list', { name: 'Search results' }).getByRole('listitem').filter({ hasText: reg });
  const number = Number((await result.textContent())!.match(/#(\d+)/)![1]);
  await result.getByRole('button', { name: `Check in #${number}`, exact: true }).click();
  await expect(result).toContainText('Waiting · pool');
  await qm.getByRole('searchbox', { name: 'Search candidates' }).fill('');
  await qm.getByRole('combobox', { name: `Line up #${number} for a panel`, exact: true }).selectOption({ label: panelName });

  // Projector (no login), from the admin's link.
  const admin = await signIn(browser, 'admin', '/admin');
  const projectorLink = (await admin.getByRole('link', { name: 'Open projector' }).getAttribute('href'))!;
  const projector = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await projector.goto(projectorLink);
  const tile = projector.getByRole('region', { name: panelName });
  await expect(tile.getByText(candidateName)).toBeVisible(); // "Up next"

  // Two panelists sit in the new panel.
  const first = await signIn(browser, 'panelist1', '/panel');
  const second = await signIn(browser, 'panelist2', '/panel');
  await joinPanel(first, panelName);
  await joinPanel(second, panelName);

  // Send in: the projector shows it within seconds, and both panelists see the application.
  await qm.getByRole('region', { name: panelName }).getByRole('button', { name: `Send #${number} in to ${panelName}` }).click();
  await expect(tile.getByText('Now interviewing')).toBeVisible();
  await expect(tile.getByText(candidateName)).toBeVisible();
  for (const page of [first, second]) {
    await expect(page.getByRole('heading', { name: `#${number} ${candidateName}` })).toBeVisible();
  }

  // They talk about the candidate.
  await first.getByRole('textbox', { name: 'Message' }).fill('Clear answers on ownership');
  await first.getByRole('textbox', { name: 'Message' }).press('Enter');
  await expect(second.getByRole('log', { name: 'Messages' })).toContainText('Clear answers on ownership');

  // One of them ends the interview; both evaluate.
  await first.getByRole('button', { name: 'End interview' }).click();
  await expect(first.getByText(/^Interview ended/)).toBeVisible();
  await expect(tile.getByText('Free')).toBeVisible();
  await evaluate(first, 'Strong Yes', '5');
  await evaluate(second, 'Yes', '4');
  await expect(second.getByText('2 panelists have submitted')).toBeVisible();

  // Admin: results, decision, publish.
  await admin.goto('/results');
  await admin.getByRole('searchbox').fill(reg);
  const row = admin.getByRole('table', { name: 'Results' }).getByRole('row').filter({ hasText: reg });
  await expect(row).toContainText('1 Strong Yes · 1 Yes');
  await expect(row).toContainText('4.5');
  await row.getByRole('combobox', { name: `Decision for #${number} ${candidateName}` }).selectOption('selected');
  await expect(row.getByRole('combobox')).toHaveValue('selected');
  admin.once('dialog', (dialog) => void dialog.accept());
  await admin.getByRole('button', { name: 'Publish results' }).click();
  await expect(admin.getByText('Published', { exact: true })).toBeVisible();

  // The public page lists the candidate.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto('/selected');
  await visitor.getByRole('searchbox', { name: 'Find your name or reg number' }).fill(reg);
  await expect(visitor.getByRole('list', { name: 'Selected candidates' })).toContainText(candidateName);
});

// Put the shared dev database back: unpublish, clear the decision, empty and delete our panel.
test.afterAll(async () => {
  const env = localEnv();
  const as = async (username: string) => {
    const client = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
    await client.auth.signInWithPassword({ email: usernameToEmail(username), password: PASSWORD });
    return createApi(client);
  };
  const [admin, qm, first, second] = await Promise.all(['admin', 'queue', 'panelist1', 'panelist2'].map(as));
  await admin.setResultsPublished(false).catch(() => undefined);
  const board = await qm.boardSnapshot();
  const candidate = (await qm.listCandidates(board.induction.id)).find((c) => c.reg_number === reg);
  if (candidate) await admin.setDecision(candidate.id, 'undecided').catch(() => undefined);
  await first.setMyPanel(null).catch(() => undefined);
  await second.setMyPanel(null).catch(() => undefined);
  const panel = board.panels.find((p) => p.name === panelName);
  if (panel?.current) await qm.endInterview(panel.current.interview_id).catch(() => undefined);
  if (panel) await qm.deletePanel(panel.id).catch(() => undefined);
});
```

- [ ] **Step 5: Run it**

Start the stack first: `npm run db:start`, `npm run seed:dev`, `npm run web:env`, and `npm run functions:serve` in a second terminal. Playwright starts the dev server on port 5173 itself, or reuses one that is already running.

Run: `npm run test:e2e`
Expected: `1 passed`, in under a minute.

Run it twice more. It must pass every time: it uses a fresh candidate and panel on each run and cleans up after itself.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore playwright.config.ts tests/e2e/induction-day.spec.ts
git commit -m "test(e2e): induction day in real browsers"
```

---

### Task 12: Deployment guide, readme and the final check

**Files:**
- Create: `docs/deployment.md`
- Modify: `readme.md`

**Interfaces:**
- Consumes: everything above; spec §13; the Plan 1 and Plan 2 review carry-overs (JWT expiry 600 s, signups off, Realtime public channels on, never run `db:test` against production).
- Produces:
  - The deployment and induction-day guide.
  - The updated readme.

- [ ] **Step 1: Write the deployment guide**

`docs/deployment.md`:

````markdown
# Deploying the induction system

Everything runs on free tiers: **Supabase** (database, logins, live updates, one edge function) in the
Mumbai region, and **Cloudflare Pages** for the website. Plan about an hour the first time.

You need: the GitHub repository, a Supabase account, a Cloudflare account, and this repo checked out
with `npm install` done.

> **Never** run `npm run db:test`, `npm run db:reset` or the test suites against the production
> project. The database tests install helper functions that must not exist in production, and a reset
> deletes everything.

## 1. Create the Supabase project

1. On supabase.com choose **New project**. Region: **South Asia (Mumbai)**. Use a long database
   password and keep it in the club's password manager; you need it once, in step 3.
2. When the project is ready, open **Project Settings → API keys** and note:
   - the **Project URL** (`https://<ref>.supabase.co`) and the project ref (`<ref>`);
   - the **anon / publishable** key: safe to put in the website;
   - the **service_role / secret** key: never put it in the website, a file in the repo, or chat.

## 2. Set up logins and live updates in the dashboard

- **Authentication → Sign In / Providers:** turn **off** "Allow new users to sign up". Keep the Email
  provider on (people sign in with a username, which the app turns into an internal email address).
  Email confirmations are not needed: admins create every account already confirmed.
- **Access-token lifetime:** set the JWT / access-token expiry to **600 seconds** (10 minutes), the
  same as `supabase/config.toml`. A disabled account then loses live updates within 10 minutes. The
  setting is in the Authentication settings (older dashboards show it under Project Settings → API →
  JWT settings).
- **Realtime → Settings:** leave **"Allow public access to channels" on** (the default). The projector
  listens on a public channel; staff channels stay private and checked. If this is off, the projector
  still works but only updates every 30 seconds, with an amber dot.

## 3. Push the database and the edge function

From the repository folder:

```bash
npx supabase login                           # opens the browser once
npx supabase link --project-ref <ref>        # asks for the database password from step 1
npx supabase db push                         # creates the tables, functions and the Fall 2026 induction
npx supabase functions deploy admin-users    # account management (create, reset password, disable)
```

`db push` applies every file in `supabase/migrations/` in order; run it again after future changes.
The edge function gets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from Supabase automatically.

If creating an account from the admin page later fails with "Not allowed" or an "Invalid JWT" error
even though you are signed in as an admin, redeploy with
`npx supabase functions deploy admin-users --no-verify-jwt`. That is safe: the function checks that
the caller is an active admin itself before doing anything.

## 4. Create the first admin

Run this once, from the repository folder, with the production URL and **service_role** key. Start
the line with a space so the shell does not keep it in its history, and use a temporary password:

```bash
 SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
  npm run create-admin -- --username <username> --name "<Your Name>" --password '<temporary password>'
```

After the website is up (step 5), sign in, open **Admin → Accounts**, and use **Reset password** on
your own row to choose a real password. Create every other account from that page.

## 5. Publish the website on Cloudflare Pages

1. In Cloudflare: **Workers & Pages → Create → Pages → Connect to Git**, and pick the repository.
2. Production branch: `main`. Build command: `npm run build`. Build output directory: `dist`.
3. Environment variables (Production):
   - `VITE_SUPABASE_URL` = the Project URL
   - `VITE_SUPABASE_ANON_KEY` = the anon / publishable key (never the service_role key)
   - `NODE_VERSION` = `24`
4. Deploy. Pages serves the app for every path because the build has no `404.html`, so links such as
   `/queue` or `/display?key=…` work when opened directly.

## 6. Check it

On the Pages URL:

1. `/selected` shows "Results not announced yet" without signing in.
2. Sign in as your admin: you land on `/admin` and see your account.
3. Create a queue manager and a panelist account, sign in with each in a private window.
4. On `/admin`, open the projector link on another device: both panels show **Free** and a green dot.
5. As the queue manager, import the latest CSV (see step 7), check someone in and send them into a
   panel: the projector changes within a second; the panelist sees the application.
6. Undo it: **End interview**, then open **Results** and set the decision back if you changed it.

## 7. Before induction day

- **Un-pause the project.** Free Supabase projects pause after 7 days without activity; open the
  dashboard and restore it a day early.
- **Evaluation criteria.** The migration seeds placeholder criteria. To use the club's real ones, run
  this in the dashboard's **SQL Editor before anyone submits an evaluation** (edit the rows first):

  ```sql
  begin;
  delete from public.evaluation_criteria where induction_id = (select id from public.inductions where is_active);
  insert into public.evaluation_criteria (induction_id, key, label, category, sort_order)
  select i.id, c.key, c.label, c.category::public.criterion_category, c.sort_order
  from public.inductions i,
       (values
         ('communication', 'Communication', 'general', 1),
         ('teamwork', 'Teamwork', 'general', 2),
         ('fit_dev', 'Dev', 'team_fit', 3)
       ) as c(key, label, category, sort_order)
  where i.is_active;
  commit;
  ```

  Keys are lowercase letters, digits and `_`. `general` criteria are scored 1–5; `team_fit` ones 1–5
  or N/A.
- **Accounts:** create or check every panelist, the queue manager and admins; disable anyone who
  should not sign in.
- **Settings** (Admin page): induction name and target interview length.
- **Candidates:** export the Google Form responses as CSV and import them from the queue board.
  Importing again later is safe.
- **Projector:** open the projector link on the projector machine and leave it running. If the link
  is ever shared by mistake, use **Make a new link** and open the new one.
- **Dry run:** rehearse on a separate free Supabase project (repeat steps 1–5 with it and a second
  Pages project), not on the production data.

## 8. After the interviews

1. **Results:** check evaluations, set each decision, and export both CSV files.
2. **Publish results.** Evaluations lock; `/selected` lists everyone marked Selected. Unpublish if
   something needs fixing.
3. **Next year:** create a new induction in the SQL Editor with
   `select public.create_induction('Fall 2027');` (it becomes the active one with placeholder
   criteria), update `src/csv/formLayout.ts` to the new form, and deploy.
````

- [ ] **Step 2: Update the readme**

Replace `readme.md` with:

````markdown
# MLSA Induction System

Realtime web app for Microsoft Club GIKI inductions: queue manager board, panelist screen with
per-candidate chat and evaluations, projector display, admin results and a public results page.
Design: `docs/superpowers/specs/2026-09-25-induction-system-design.md`.
Deploying to Supabase and Cloudflare Pages: `docs/deployment.md`.

## Local development

Requirements: Node 24+, Docker (your user must be in the `docker` group).

```bash
npm install
npm run db:start        # first run downloads the Supabase images
npm run db:reset        # applies supabase/migrations
npm run seed:dev        # accounts admin, queue, panelist1-4 (password: induction-dev) + 60 fake candidates
npm run functions:serve # in a second terminal: serves the admin-users edge function
```

`npm run db:start` skips Studio and other services the app doesn't use, to save disk space.

## Web app

```bash
npm run web:env   # writes .env.local from the running local stack
npm run dev       # http://localhost:5173
```

Sign in with password `induction-dev` as:

- `queue` (queue manager): `/queue`, the board for check-in, lanes and send-in.
- `panelist1` to `panelist4`: `/panel`, the candidate's application, the panel's discussion and your
  evaluation.
- `admin`: `/admin` (accounts, panels, settings, projector link) and `/results` (decisions, the full
  record of each candidate, CSV exports, publishing). Admins can open every screen.

The projector link is on the admin page (`/admin` → Projector link); open it on the projector machine.
It needs no login. Anyone with the link can see the projector screen, so share it only with whoever
runs the projector. `/selected` is public: it lists the selected candidates once results are published.

`npm run build` writes the static site to `dist/`. `npm run typecheck` checks the TypeScript.

## Tests

```bash
npm run db:test           # pgTAP: every action, RLS rule and privilege
npm run test:unit         # Vitest unit and component tests (web tests run in jsdom)
npm run test:integration  # needs db:start + functions:serve running
npm run test:e2e          # Playwright: the whole induction day in Chromium; needs db:start,
                          # seed:dev, functions:serve and web:env, and starts the dev server itself
```

Each E2E run imports one candidate named "Eesha Test …" and leaves it in the local database;
`npm run db:reset && npm run seed:dev` clears them.

## Accounts

There is no signup. Create the first admin with
`npm run create-admin -- --username <u> --name "<Name>" --password <p>`
(for production, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` first). Admins create every
other account from the app (`/admin` → Accounts).

## Data safety

Never commit the Google Forms CSV export: `*.csv` is gitignored except `fixtures/`.
````

- [ ] **Step 3: Run everything from a clean database**

With `npm run functions:serve` running in a second terminal:

Run: `npm run db:reset && npm run db:test && npm run seed:dev && npm run test:unit && npm run test:integration && npm run typecheck && npm run build && npm run test:e2e`
Expected:
- `Result: PASS` (`Tests=199`)
- `Tests  171 passed (171)`
- `Tests  18 passed (18)`
- `tsc` prints nothing.
- The build ends with `✓ built in …`.
- `1 passed`.

- [ ] **Step 4: Check it in a real browser**

Run `npm run db:reset && npm run seed:dev`, then `npm run dev`. Use four browser profiles or private windows at 1440×900; on one of them, also check a phone viewport (390×844).

1. As `queue`, check in #1 and #2 and send #1 into Panel 1.
2. As `panelist1` and `panelist2`, open `/panel` and choose Panel 1.
   - Both see #1's card with the timer, the application tabs (blank sections hidden), the discussion and the form.
   - A message from one appears for the other within a second.
   - Reload with a half-filled form: the draft is still there.
   - At phone width the page shows the Application / Chat / Evaluate tabs.
3. `panelist1` submits an evaluation: `panelist2`'s form says "1 panelist has submitted".
4. As `queue`, end #1's interview and send in #2.
   - `panelist2` sees #2, and #1 appears under Recent with "Evaluation pending".
   - Opening #1 brings back the draft. Submit it.
5. As `admin`, go to `/admin`:
   - Create a panelist account with a generated password, then sign in with it in another window.
   - Disable it; that window is signed out on its next action.
   - Change the target length to 20 minutes; the timers turn amber at 20:00.
6. On `/results`:
   - #1 shows 2 evaluations, the averages and the tally.
   - Set #1 to **Selected** and open #1's record, which shows the discussion and both evaluations.
   - Export both CSV files and open them in a spreadsheet.
7. **Publish results**:
   - The panelists' forms turn read-only without a reload.
   - A private window on `/selected` lists #1.
   - **Unpublish**, and `/selected` says "Results not announced yet" again.
8. Open the projector link, then run `docker stop supabase_realtime_yawar-work`, wait 10 s, and run `docker start supabase_realtime_yawar-work`. The staff screens show "Reconnecting…" and recover by themselves; the projector's dot turns amber and then green.

If no browser is available where this runs, say so in the report and do not mark this step done.

- [ ] **Step 5: Reset the local data and commit**

Run: `npm run db:reset && npm run seed:dev`

```bash
git add docs/deployment.md readme.md
git commit -m "docs: deployment guide and the Plan 3 screens"
```
