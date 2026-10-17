# MLSA Induction System

Realtime web app for Microsoft Club GIKI inductions: queue manager board, panelist screen with
per-candidate chat and evaluations, projector display, admin results and a public results page.
Design: `docs/superpowers/specs/2026-09-25-induction-system-design.md`.
Deploying to Supabase and Cloudflare Pages: `docs/deployment.md`. New Google Form responses can
reach the app by themselves: `docs/google-form-sync.md`.

## Local development

**Setting up on a new machine? Follow [`SETUP.md`](SETUP.md)** for every step: prerequisites, the first run,
the sign-in accounts, running the checks and troubleshooting. The commands below are the short version.

Requirements: Node 24+, Docker (your user must be in the `docker` group).

```bash
npm install
npm run db:start        # first run downloads the Supabase images
npm run db:reset        # applies supabase/migrations
npm run seed:dev        # accounts admin, queue, photos, panelist1-4 (password: induction-dev) + 60 fake candidates
cp supabase/functions/.env.example supabase/functions/.env   # local secret for form-sync
npm run functions:serve # in a second terminal: serves the admin-users and form-sync edge functions
```

`npm run db:start` skips Studio and other services the app doesn't use, to save disk space.

## Web app

```bash
npm run web:env   # writes .env.local from the running local stack
npm run dev       # http://localhost:5173
```

Sign in with password `induction-dev` as:

- `queue` (queue manager): `/queue`, the board for check-in, lanes and send-in.
- `photos` (photographer): `/photos`, a phone screen listing everyone waiting; tap a name, take the
  photo, save. While developing, photos are saved in `.local-photos/` (Cloudflare R2 in production).
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

Each E2E run imports a few candidates ("Eesha Test …", "Chat Test …", "Photo Ready …") and leaves them in the local database;
`npm run db:reset && npm run seed:dev` clears them.

### Stress tests

Heavier checks to run before an event or after a big change. They run only against the **local** stack (they
reach the database through its Docker container) and never touch production. Each needs `npm run db:start`,
Docker, and Chromium for Playwright (`npx playwright install chromium` on a new machine).

```bash
npm run stress:races           # conflicting actions at the same instant (two desks sending in, two panelists
                               # pressing End or Ready, undo vs end, delete panel vs send-in, ...) plus a burst of
                               # 260 chat sends; checks the data stays consistent. `-- 5` for 5 rounds (default 20)
npm run stress:offline         # connection drops in real Chromium: offline, dead Wi-Fi and lost replies during
                               # chat, End, Ready, evaluations, reloads, the desk, the projector and photos;
                               # needs web:env and starts the dev server itself (about 8 minutes)
npm run stress:day             # a whole induction day: 45 candidates, 3 panels x 4 panelists, random connection
                               # drops and three live browser windows; needs web:env and `npm run dev` running
```

`stress:day` runs in a fresh induction of its own and switches back to the previous one when it ends
(about 13 minutes; `SIM_CANDIDATES=6 SIM_MIN_S=5 SIM_MAX_S=8 npm run stress:day` for a quick run). All three
leave their test accounts (`rc_…`, `nc_…`, `np_…`, `ds_…`) and candidates in the local database; `npm run db:reset && npm run seed:dev`
clears them. A few "Can't reach the server" errors in `stress:races` under the chat burst can come from Node's
HTTP client reusing a connection the local gateway closed; the test resends them as the app does.

## Accounts

There is no signup. Create the first admin with
`npm run create-admin -- --username <u> --name "<Name>" --password <p>`
(for production, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` first). Admins create every
other account from the app (`/admin` → Accounts). They can also reset passwords, change roles,
disable accounts, and delete accounts that have no evaluations or chat messages. An account with
either is disabled instead, so its history stays attached to it. Nobody can change their own role
or delete their own account. The owner's account, `adminmlsa`, is protected: no other admin can
reset its password, disable it, change its role or delete it. To protect another account, add its
username to `PROTECTED_USERNAMES` in `supabase/functions/_shared/accounts.ts` and redeploy `admin-users`.

## Data safety

Never commit the Google Forms CSV export: `*.csv` is gitignored except `fixtures/`.
