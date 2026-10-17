# Local setup

How to run the whole induction system on your own machine: the database, logins, live updates, the edge
functions and the website, with fake accounts and candidates to try every screen. Nothing here touches the
production project.

When you're done you will have three things running:

```
Docker              local Supabase stack: Postgres, Auth, Realtime, API gateway   http://127.0.0.1:54321
terminal 1          npm run functions:serve   (admin-users and form-sync edge functions)
terminal 2          npm run dev               (the website)                       http://localhost:5173
```

How the pieces fit together: [`docs/architecture.md`](docs/architecture.md).

## 1. Install the prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| **Node.js** | 24 or newer | `node --version` to check. The scripts run `.ts` files directly with `node`, which needs Node 24+. |
| **Docker** | any recent | Windows and macOS: install Docker Desktop and **start it** before step 4. Linux: Docker Engine, and your user must be in the `docker` group (`sudo usermod -aG docker $USER`, then log out and back in). |
| **Git** | any | To clone the repository. |

You don't need to install the Supabase CLI separately: it comes with `npm install` and the npm scripts
run it for you. For any other Supabase command, use `npx supabase …`.

The first start downloads the Supabase Docker images. That takes a while and a few GB of disk.

## 2. Get the code

```bash
git clone https://github.com/magnificentthrush/inductions-mlsa.git
cd inductions-mlsa
npm install
```

## 3. Check Docker is running

```bash
docker info
```

If it prints an error, start Docker Desktop (or the Docker service on Linux) and try again.

## 4. Start the local backend

```bash
npm run db:start   # starts the local Supabase stack in Docker (first run downloads the images)
npm run db:reset   # applies every migration in supabase/migrations/ (creates the "Fall 2026" induction)
npm run seed:dev   # adds 7 accounts and 60 fake candidates
```

- `db:start` skips the services the app doesn't use (Studio, Storage, the mail catcher and more), to save
  disk and memory.
- `db:reset` **deletes all local data** and rebuilds the database from the migrations. Only run it when you
  want a clean slate.
- `seed:dev` is safe to run again. Accounts that already exist are skipped (it prints `exists`), and the
  candidates are updated, not duplicated.

## 5. Start the edge functions (terminal 1)

The edge functions need one local secret. Copy the example file, then start them:

```bash
cp supabase/functions/.env.example supabase/functions/.env
npm run functions:serve
```

Leave this terminal running. You need it to create, edit, disable or delete accounts on `/admin`
(`admin-users`), and for the Google Form sync (`form-sync`). Every other screen works without it.

To check it's up, call the form sync without its secret. It should answer `401 {"error":"Not allowed"}`:

```bash
curl -i -X POST http://127.0.0.1:54321/functions/v1/form-sync -d '{}'
```

`503` instead means `supabase/functions/.env` is missing: copy it and restart `functions:serve`.

## 6. Start the website (terminal 2)

```bash
npm run web:env   # writes .env.local with the local stack's URL and anon key
npm run dev       # http://localhost:5173
```

Open http://localhost:5173.

## 7. Sign in and try it

Every seeded account uses the password **`induction-dev`**.

| Username | Role | Lands on | What to try |
| --- | --- | --- | --- |
| `admin` | Admin | `/admin` | Accounts, panels, settings, the projector link; `/results` for decisions, CSV exports and publishing. Admins can open every screen. |
| `queue` | Queue manager | `/queue` | Check candidates in, line them up, send them into a panel, end or undo. **Import CSV** accepts `fixtures/form-export-fake.csv`. |
| `photos` | Photographer | `/photos` | Photograph waiting candidates. Photos are saved in `.local-photos/` (Cloudflare R2 in production). |
| `panelist1` … `panelist4` | Panelist | `/panel` | Pick a panel, read the application, chat with the panel, submit an evaluation, press **Ready for next candidate**. |

A quick run through one interview:

1. In one browser window, sign in as `panelist1` and pick **Panel 1**.
2. In a private window, sign in as `queue`. Check someone in, then **Send in → Panel 1**. If the candidate
   has no photo, the board asks first; **Send without photo** is fine.
3. The panelist's screen shows the candidate straight away. Chat, then **End interview** and evaluate.
4. As `admin`, open `/admin` → **Projector link** in another tab to see the projector screen, and
   `/results` to see the evaluation.
5. `/selected` is the public page. It lists selected candidates once results are published.

Use separate browsers or private windows for each account: one browser keeps one signed-in account.

To try the phone screens (`/photos`, `/panel`), use your browser's device toolbar (F12 → device mode).
The local setup is for this machine only: a phone on your Wi-Fi can't reach `127.0.0.1`.

Want an admin with your own name? `npm run create-admin -- --username <u> --name "<Name>" --password <p>`
creates one on the local stack.

## 8. Run the checks

```bash
npm run typecheck          # TypeScript
npm run test:unit          # Vitest unit and component tests; needs nothing running
npm run db:test            # pgTAP database tests; needs db:start
npm run test:integration   # needs db:start and functions:serve
```

For the browser tests, install Chromium once, then run them (needs db:start, seed:dev, functions:serve and
web:env; Playwright starts the website itself):

```bash
npx playwright install chromium
npm run test:e2e
```

The tests leave their own accounts and candidates in the local database. `npm run db:reset && npm run seed:dev`
clears them. The heavier stress tests (`stress:races`, `stress:offline`, `stress:day`) are described in the
[readme](readme.md#stress-tests).

## 9. Day to day

| I want to… | Run |
| --- | --- |
| Start again after a reboot | Start Docker, then `npm run db:start`, `npm run functions:serve` and `npm run dev`. Your data is still there; no reset or seed needed. |
| Get a clean slate | `npm run db:reset && npm run seed:dev` |
| Pick up new migrations after pulling | `npm install`, then `npm run db:reset && npm run seed:dev` |
| Stop everything | Ctrl+C in both terminals, then `npm run db:stop` |
| Look at the database | Any Postgres client: `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Build the production site | `npm run build` (writes `dist/`), `npm run preview` to serve it (photos only load under `npm run dev`) |

Local ports: **54321** API gateway (database API, logins, live updates, and edge functions at
`/functions/v1/<name>`), **54322** Postgres, **5173** the website.

Files the setup creates, all git-ignored: `.env.local`, `supabase/functions/.env`, `.local-photos/`.

## 10. Troubleshooting

**The website shows "Missing VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY".**
Run `npm run web:env` while the stack is running, then restart `npm run dev`.

**A script says "Local Supabase is not running. Start it with: npm run db:start".**
`web:env`, `seed:dev` and the tests read the stack's keys from `npx supabase status`. Start the stack first.

**`db:start` fails with "Cannot connect to the Docker daemon" or "permission denied".**
Docker isn't running, or (Linux) your user isn't in the `docker` group yet. See step 1.

**`db:start` says a port is already allocated.**
Another Supabase project is running on the same ports. Stop it with `npx supabase stop` in that project's
folder, or `docker ps` to find what's using port 54321 or 54322.

**Creating an account on `/admin` fails with "Can't reach the server".**
`npm run functions:serve` isn't running (step 5).

**Sign-in or "Your sign-in is reconnecting" errors after restarting the stack.**
Run `npm run web:env` again and restart `npm run dev`, then sign in again.

**The camera doesn't start on `/photos`.**
The browser asks for camera permission the first time; allow it. Without a camera, use **Choose a file
instead**.

**Environment variables in PowerShell.**
Commands written as `NAME=value npm run …` are for bash. In PowerShell, set the variable first:
`$env:SIM_CANDIDATES=6; npm run stress:day`.

## Never against production

`db:reset`, `db:test` and the test suites are for the local stack only. A reset deletes everything, and the
database tests install helper functions that must not exist in production. Deploying is a separate guide:
[`docs/deployment.md`](docs/deployment.md).
