# Google Form sync

New Google Form responses reach the app on their own, a few seconds after someone submits the form.
You don't need to export a CSV.

```
Google Form → responses sheet → Apps Script ("On form submit")
  → form-sync edge function (checks a shared secret)
  → sync_form_response: the CSV import's rules → the queue board updates live
```

- **Same rules as Import CSV.** People are matched by reg number. A new person gets the next number.
  A later response for a reg number already on the list updates the details but keeps the number,
  status and place in the queue.
- **Warnings on the queue board.** What the CSV import lists under "Needs a closer look" shows in an
  amber box under the top bar on `/queue` instead, until a queue manager or admin dismisses it:
  - a response without a reg number (skipped)
  - a new reg number whose email belongs to someone already on the list (possible typo)
  - another response for a reg number already on the list (with the earlier name if it changed)
  - a response that couldn't be imported because the form's questions changed
- **The form must match the app.** The script sends the sheet's header row with every response. If
  the questions no longer match `supabase/functions/_shared/formLayout.ts`, nothing is imported and
  the board shows a warning; nothing is filed under the wrong question. Adding, removing, renaming or
  reordering questions, or adding columns to the responses sheet, all count as changes.
- **Import CSV still works** and is safe to repeat. Use it to catch up on anything the sync missed.

## Set it up

### 1. Choose a secret and give it to Supabase

Make a long random value, for example with `openssl rand -hex 32`. In the Supabase dashboard open
**Edge Functions → Secrets** and add `FORM_SYNC_SECRET` with that value.

Deploy the function with the gateway's login check off (Google can't sign in to Supabase; the
function checks the secret itself):

```bash
npx supabase functions deploy form-sync --no-verify-jwt
```

Test it without the secret. It should answer `401 {"error":"Not allowed"}`:

```bash
curl -i -X POST https://<ref>.supabase.co/functions/v1/form-sync -d '{}'
```

### 2. Add the script to the responses sheet

Use a Google account that can edit the form's responses sheet, ideally the form owner's. The
script runs as this account.

1. Open the responses sheet (in the form: **Responses → View in Sheets**).
2. **Extensions → Apps Script.** Replace the contents of `Code.gs` with
   [`scripts/google-form-sync.gs`](../scripts/google-form-sync.gs) and save.
3. **Project Settings** (gear icon) **→ Script properties → Add script property**, twice:
   - `SYNC_URL`: `https://<ref>.supabase.co/functions/v1/form-sync`
   - `SYNC_SECRET`: the secret from step 1
4. **Triggers** (clock icon) **→ Add Trigger:** function `onFormSubmit`, event source
   **From spreadsheet**, event type **On form submit**. Set **Failure notification settings** to
   **Notify me immediately**. Save, then allow the permissions Google asks for. They are the
   spreadsheet (to read the new row) and external requests (to reach the app).

### 3. Check it

In the Apps Script editor pick `sendLatestResponse` and press **Run**. The log should show something
like `Row 245: {"added":0,"updated":0,"flagged":[]}` when that person is already imported, or
`"added":1` when they weren't. Then submit a test response to the form and watch it appear on `/queue`
(Registered count, search), and dismiss any warning it raised.

A test response is a real candidate in the app. Use a made-up reg number and remember to ignore it.
The app has no screen for deleting candidates.

## When something goes wrong

- **Google emails you "Summary of failures".** The message includes the app's answer:
  - `HTTP 401`: `SYNC_SECRET` doesn't match `FORM_SYNC_SECRET`.
  - `HTTP 503`: `FORM_SYNC_SECRET` isn't set in Supabase.
  - `HTTP 409 No active induction`: create or activate the induction first.
  - `HTTP 422`: the form changed (there is also a warning on the board). Update `formLayout.ts`
    to the new form and deploy the app and the function.

  After fixing it, use **Import CSV** to bring in the responses that were missed.
- **Nothing happens at all.** Check the trigger exists (Apps Script → Triggers) and its runs under
  **Executions**. Check the function's logs in the Supabase dashboard (Edge Functions → form-sync →
  Logs).
- **Changing the secret.** Set the new value in both places, Supabase first. Responses submitted in
  between fail and are listed in Google's failure email.

## Next year's form

Update `supabase/functions/_shared/formLayout.ts` to the new form's columns (the CSV import uses it
too). Deploy the website and `npx supabase functions deploy form-sync --no-verify-jwt`. Then add
the script to the new form's responses sheet as above.

## Local development

`npm run functions:serve` serves `form-sync` with the secret from `supabase/functions/.env` (copy
`supabase/functions/.env.example`). `tests/integration/form-sync.test.ts` calls it the way the
script does, and `tests/unit/googleFormSyncScript.test.ts` runs the script itself against stand-ins
for Google's services.
