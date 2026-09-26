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
   panel: the projector changes within a second; the panelist sees the application. Don't chat,
   evaluate or set a decision for them.
6. Undo it straight away, in this order: **Undo send-in** on the panel card, **Back to pool** on the
   candidate, then **Undo check-in**. They are Registered again, as if nothing happened. Never use
   **End interview** here: it marks a real candidate as interviewed, and on the day they can't be
   checked in. (Better still, run this whole check on the dry-run project from step 7.)

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
