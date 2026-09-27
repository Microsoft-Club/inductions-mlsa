# Candidate Photos: Design Spec

**Date:** 2026-09-27
**Status:** Approved in conversation, pending written-spec review
**Builds on:** `2026-09-25-induction-system-design.md` (roles, queue, realtime, deployment)

---

## 1. Goal

Photograph every candidate after check-in and before their interview, so panelists and admins can put a face to
each name: during the interview, when looking back at who they evaluated, and when deciding results.

**Success looks like:**
- A new **Photographer** works through the waiting candidates on a phone: tap a name, take the photo, save, next.
  A photo uploads in about a second on mobile data.
- The queue manager is warned when sending someone in without a photo, and can take it on the spot or send anyway.
- Panelists see the photo on the candidate card; admins see it on the candidate's results page.
- The photographer sees nothing beyond who is waiting (number, name, photo).
- Hosting cost stays $0.

## 2. Decisions

| Question | Decision |
|---|---|
| What are photos for? | Recognition: panelists (during and after the interview) and admins (deciding results). |
| New role | `photographer`, shown as "Photographer". Created by an admin in Admin → Accounts like every other account; there is no self sign-up. |
| Who the photographer sees | Every candidate whose status is `waiting`: the waiting pool **and** people lined up for a panel. |
| Sending in without a photo | Allowed. The queue manager gets a popup: Take photo / Send without photo / Cancel. |
| Where photos are stored | A private Cloudflare R2 bucket, `mlsa-induction-photos`. Not Supabase Storage. |
| How the browser reaches R2 | A Cloudflare Pages Function in this repo (`/api/photos/...`), deployed with the site. It asks Supabase, with the user's own login token, whether each request is allowed. |
| Photo size | Shrunk in the browser to 800 px on the long side, JPEG (about 100 KB). The server refuses anything over 1 MB or not JPEG. |
| Photos per candidate | One. A retake replaces it. |
| How long photos are kept | Until an admin presses **Delete all photos**. No automatic expiry. |

## 3. Roles and access

| Who | Take photos | See photos | Anything else |
|---|---|---|---|
| **Photographer** | Waiting candidates only | Waiting candidates only | Nothing. No candidate table, queue board, form answers, contact details, chats or evaluations. |
| **Queue manager** | Any candidate in the active induction | Yes | Unchanged. |
| **Panelist** | No | Yes | Unchanged. |
| **Admin** | Any candidate in the active induction | Yes | Unchanged, plus **Delete all photos**. |
| **Projector / public page** | — | **Never** | Unchanged. |

Every existing read policy and action function names the roles it allows, so the new role starts with no access.
It gets exactly three things: its own profile row, the "board changed" realtime signal (a timestamp only), and the
photo functions in §6.

## 4. Screens

### 4.1 Photographer: `/photos` (phone-first)

- Logging in as a photographer lands on `/photos`. The header shows no screen links (the photographer has only one
  screen), just their name and Sign out. Admins also get a **Photos** link and can use this screen.
- Top: a count, "12 need photo · 30 done", and a search box (number or name).
- **Needs photo:** waiting candidates without a photo, earliest check-in first.
- **Done:** waiting candidates with a photo, most recent photo first, each with a small thumbnail.
- Rows are large tap targets: `#12` and the name. The lists update live (the same "board changed" signal the queue
  screen uses), so a check-in appears within a second and a sent-in candidate disappears.
- Tapping a row opens the **capture view** (§4.2). Tapping a Done row opens it showing the current photo with **Retake**.
- Empty states: "Nobody is waiting." / "Everyone waiting has a photo." Standard connection banner when offline.

### 4.2 Capture view (shared by photographer, queue manager, admin)

- Full screen on a phone, a dialog on a laptop. Shows **#12 Ali Khan** in large text so the right person is photographed.
- **On a phone** (coarse pointer): one big **Take photo** button that opens the phone's own camera
  (`<input type="file" accept="image/*" capture="environment">`, back camera).
- **On a laptop** (fine pointer): a live webcam preview (`getUserMedia`) with **Capture**, plus "Choose a file instead".
  If there is no camera or permission is refused, only the file option is shown, with a one-line reason.
- After capture: the shrunk photo as a preview with **Save** and **Retake**. Save shows "Saving…"; on success the view
  closes and the list updates. On failure the preview stays, with the error and **Try again** (no re-shoot needed).

### 4.3 Queue manager: `/queue`

- A small "no photo" camera icon next to each person without a photo, in the waiting pool and in every panel's line.
  Tapping it opens the capture view.
- Both **Send in** buttons (the pool's "Send in → Panel N" and the first-in-line "Send in") check the photo first.
  Without one, a popup: "#12 Ali Khan has no photo yet." with **Take photo**, **Send without photo**, **Cancel**.
  - **Take photo** opens the capture view; once the photo is saved, the send-in runs automatically.
    If the send-in then fails (for example the panel just became busy), the usual error toast shows and the photo is kept.
  - **Send without photo** sends in as today.
- With a photo, Send in behaves exactly as today (no popup).

### 4.4 Where photos appear

- **Panelists:** on the candidate card (`CandidateCard`, used by the Interview, Recent, Evaluated and Find sections)
  and at the top of the application dialog.
- **Admins:** on the candidate's results page (`/results/:candidateId`) and in the application dialog.
- Without a photo: a neutral placeholder (initials on grey), never a broken image.
- Not in the Results table (300 thumbnails would mean 300 authorised downloads).

### 4.5 Admin: Delete all photos

- A new **Photos** section on `/admin`: "283 photos stored." and a danger button **Delete all photos**.
- Confirmation: "Delete all 283 photos? This can't be undone." It deletes every file in the bucket and clears every
  candidate's photo record, across all inductions. Safe to run again if it is interrupted.
- No per-photo delete (a retake replaces a photo).

## 5. Architecture

```
 phone / laptop browser
   │  PUT/GET/DELETE /api/photos/...   (Authorization: Bearer <user's Supabase token>)
   ▼
 Cloudflare Pages Function (functions/api/photos/*)  ── same site, same origin, deployed with every push to main
   │ 1. ask Supabase: may this user do this?  (POST /rest/v1/rpc/authorize_*, user's own token + anon key)
   │ 2. read/write R2 through the PHOTOS binding (no R2 keys anywhere)
   │ 3. tell Supabase what changed  (rpc/record_photo, rpc/clear_photos → broadcast "board changed")
   ▼                                   ▼
 R2 bucket mlsa-induction-photos      Supabase Postgres (permissions, photo_taken_at, realtime signal)
```

- The function never verifies tokens itself. Supabase verifies the token and applies the role rules when it runs the
  RPC, so all permission logic stays in SQL next to the existing rules.
- The function reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from the Pages project's environment variables,
  which Pages exposes to Functions at runtime as well as at build time. No new secrets.

## 6. Database (one migration: `20260927000300_candidate_photos.sql`)

**Schema**
- `alter type public.app_role add value 'photographer';` (functions compare `role::text`, so the new value is never
  used as an enum literal inside the same transaction).
- `candidates.photo_taken_at timestamptz` (null = no photo) and `candidates.photo_taken_by uuid references profiles on delete set null`.
  `updated_at` is **not** touched by photos (it tracks application and decision changes).
- Photo file key: `<induction_id>/<candidate_id>.jpg`, built by an internal helper `photo_key(candidates)`.

**Policies**
- New: `"read own profile"` on `profiles`: `id = auth.uid() and is_active`. Any active user can read their own row,
  which the app needs to learn its role. A disabled account still reads nothing.
- Replace `"staff receive board broadcasts"` on `realtime.messages` to include `photographer`.

**Functions** (security definer, `search_path = ''`, `require_role` first, like the existing ones)

| Function | Roles | Does |
|---|---|---|
| `photo_queue() → jsonb` | photographer, admin | Waiting candidates in the active induction: `candidate_id, number, name, checked_in_at, photo_taken_at`, ordered by `checked_in_at`. |
| `authorize_photo_upload(p_candidate_id) → text` | photographer (status `waiting` only), queue_manager, admin | Candidate must be in the active induction. Returns the file key. |
| `record_photo(p_candidate_id) → timestamptz` | same as above, but photographers may also record for `interviewing` (the person was sent in while the upload finished) | Sets `photo_taken_at = clock_timestamp()`, `photo_taken_by = auth.uid()`, calls `broadcast_board()`. Returns the new `photo_taken_at`. |
| `authorize_photo_view(p_candidate_id) → text` | admin, queue_manager, panelist; photographer only for `waiting` candidates | Returns the file key, or null when the candidate has no photo. |
| `photo_count() → int` | admin | Candidates with a photo, across all inductions (for the Delete all confirmation). |
| `authorize_photo_purge() → void` | admin | Raises unless the caller may delete all photos. |
| `clear_photos() → int` | admin | Nulls `photo_taken_at`/`photo_taken_by` everywhere, calls `broadcast_board()`, returns how many were cleared. |

- `lane_json` adds `has_photo` to every pool and lane entry (for the queue manager's icon and popup).
- `candidate_record` already returns `to_jsonb(c)`, so it picks up `photo_taken_at` without changes.
- Grants: the new functions are executable by `authenticated` only; `photo_key` by nobody.

## 7. Photo API (Pages Function)

| Request | Steps | Success |
|---|---|---|
| `PUT /api/photos/:candidateId` (body: JPEG bytes) | Reject `Content-Length` > 1 MB (413) → `authorize_photo_upload` → read body; reject > 1 MB (413) or not starting `FF D8 FF` (415) → `PHOTOS.put(key, body, { contentType: image/jpeg })` → `record_photo` | `200 { "photo_taken_at": "…" }` |
| `GET /api/photos/:candidateId?v=<photo_taken_at>` | `authorize_photo_view` → null = 404 → `PHOTOS.get(key)` → missing = 404 | `200` JPEG, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff` |
| `DELETE /api/photos` | `authorize_photo_purge` → list the whole bucket page by page and delete in batches of up to 1000 → `clear_photos` | `200 { "deleted": n }` |

- The file is saved **before** the record, so the database never claims a photo that isn't there. A failure after the
  save leaves at most an unrecorded file that the next retake overwrites.
- Errors are JSON `{ "error": "…" }`:
  401 missing or expired login · 403 not allowed · 404 no photo / unknown candidate · 400 refused by the database
  (its message passed through, for example "Candidate #12 is not waiting") · 405 wrong method · 413 too large ·
  415 not a JPEG · 502 Supabase or R2 unreachable or too slow (10 s timeout).
- `candidateId` must be a UUID (400 otherwise), so it can never form an unexpected key.
- **Caching:** the server sends `no-store`, because a browser cache keyed only by URL could show one user's cached
  photo to the next person on a shared laptop. The app keeps its own in-memory cache instead (§8).

**Code layout** (logic outside `functions/` so it can be unit-tested and reused by the local dev server)
- `server/photos/bucket.ts`: the `PhotoBucket` interface (`put`, `get`, `delete`, `list`), the subset of `R2Bucket` used.
- `server/photos/gate.ts`: calls the Supabase RPCs with the user's token; maps PostgREST errors to the statuses above.
- `server/photos/handler.ts`: `handlePhotoRequest(request, env, candidateId | null)`; method routing, limits, order of steps.
- `server/photos/folderBucket.ts`: a `PhotoBucket` backed by a local folder, for development and tests only.
- `functions/api/photos/[candidateId].ts` and `functions/api/photos/index.ts`: thin Pages wrappers around the handler.
- Types for the Pages context and R2 are declared by hand (minimal interfaces); no Cloudflare packages are added.

## 8. Frontend

- `Role` gains `'photographer'`; `ROLE_LABELS`, `homePath` (`/photos`), the staff nav (Photos: photographer, admin)
  and a `/photos` route guarded by `RequireRole roles={['photographer','admin']}`. The Accounts role picker offers it.
- `src/lib/api.ts` gains `photoQueue()`, `uploadPhoto(candidateId, jpeg)`, `photoBlob(candidateId, version)`,
  `photoCount()` and `deleteAllPhotos()`. The photo calls use `fetch` to `/api/photos` with the current session's
  access token, the same timeouts and the same friendly error messages as the RPC calls.
- `src/photos/shrinkPhoto.ts`: `targetSize(w, h, max = 800)` (pure) and `shrinkPhoto(file)`:
  `createImageBitmap(file, { imageOrientation: 'from-image' })` → canvas at the target size → `toBlob('image/jpeg', 0.82)`;
  if the result is still over 1 MB, once more at 0.6. Re-encoding drops EXIF, including GPS. An image the browser
  can't decode gives "This photo couldn't be read. Take it again."
- `src/photos/photoQueueView.ts` (pure): split into Needs photo / Done, order each, search, counts.
- `src/photos/PhotosPage.tsx`: the photographer screen, on `useLiveSnapshot(api.photoQueue, api.subscribeBoard)`.
- `src/photos/CaptureView.tsx`: §4.2.
- `src/photos/CandidatePhoto.tsx` + `usePhoto(candidateId, version)`: fetches once per candidate and version, keeps
  an object URL in a module-level cache (revoked when replaced, all cleared on sign-out), shows the placeholder meanwhile.
- `src/queue/`: `has_photo` on `LaneEntry`; the camera icon in `PoolList` and `PanelCard`; a `NoPhotoDialog` used by
  both Send in buttons.
- `src/panel/CandidateCard.tsx`, `src/panel/ApplicationDialog.tsx`, `src/results/CandidateRecordPage.tsx`: show `CandidatePhoto`.
  `Candidate` gains `photo_taken_at` (added to `CANDIDATE_COLUMNS`).
- `src/admin/PhotosSection.tsx`: §4.5.

## 9. Local development

- `vite.config.ts` gets a dev-only plugin (`apply: 'serve'`) that serves `/api/photos` by calling the **same**
  `handlePhotoRequest` with a `folderBucket` in the git-ignored `.local-photos/` folder, and the local Supabase URL and
  anon key from `.env`. `npm run dev` and the Playwright tests therefore exercise the real handler with no Cloudflare
  tooling installed.
- The dev seed adds one photographer account.
- `supabase/functions/_shared/accounts.ts` `ROLES` gains `photographer`.

## 10. Edge cases

- **Sent in during upload:** `record_photo` accepts `interviewing` for photographers, so the photo still counts.
- **Undo check-in:** the photo stays with the candidate; it shows again if they check in later.
- **Two people photograph the same candidate:** last save wins; both screens update to the newest photo.
- **Photo record exists but the file is gone** (for example Delete all photos removed the files but stopped before clearing the records; running it again fixes this): the view
  returns 404 and the placeholder shows.
- **Slow or flaky mobile data:** a ~100 KB upload with a 15 s timeout; failure keeps the preview for **Try again**.
- **HEIC on iPhone:** the file input hands the page a JPEG; if a browser still gives an undecodable file, the
  "couldn't be read" message asks for a retake.
- **Disabled photographer:** loses access at the next token refresh, like every other account.

## 11. Testing

- **Database (pgTAP, `supabase/tests/100_photos.test.sql`):** the photographer can read only their own profile and
  nothing else (candidates, queue, board snapshot, interviews); `photo_queue` lists only waiting candidates; upload
  permission for each role and status; `record_photo` accepts `interviewing` for photographers; panelists can view but
  not upload; only admins can count, purge and clear; `has_photo` appears in `board_snapshot` lanes; the new realtime
  policy admits photographers to `board` only.
- **Photo handler (Vitest, fake bucket + fake Supabase `fetch`):** 401/403/400 pass-through; 413 by header and by body;
  415 for non-JPEG; 400 for a non-UUID id; upload saves before recording and does not record when the save fails;
  GET headers; 404 for no photo; delete-all pages through the listing, deletes in batches, clears, and is safe to repeat.
- **Web (Vitest):** `targetSize`; `photoQueueView` split, order, search and counts; the Send in → popup decision;
  `CandidatePhoto` placeholder and cache; `folderBucket`.
- **Integration (`tests/integration`):** `photoQueue` and the new `LaneEntry.has_photo` shapes against the local stack.
- **End-to-end (Playwright):** photographer logs in, sees a checked-in candidate, uploads a test JPEG through the file
  input, the candidate moves to Done; the queue manager sees the camera icon, gets the popup, and both
  **Send without photo** and **Take photo** work; a panelist sees the photo on the candidate card; an admin deletes all photos.
- **Real phone check before merging:** a preview build of this branch with the bucket bound to previews. The preview
  uses the live Supabase project (there is only one), so it is done before the event with one test candidate that is
  removed with SQL afterwards.

## 12. Rollout

Each step is safe on its own; the live site keeps working throughout.

1. Create the R2 bucket `mlsa-induction-photos` (private, no `r2.dev` access) and bind it as `PHOTOS` to the Pages
   project for production and preview (Cloudflare MCP).
2. Apply the migration to production through the Supabase MCP, then fix its recorded version as for earlier migrations.
   It only adds things, so the current site ignores it.
3. Redeploy `admin-users` (with JWT verification off, as before) so it accepts the Photographer role.
4. Preview build of this branch; test on real phones (iPhone and Android if available); remove the test candidate.
5. Merge to `main`; Cloudflare builds and deploys it.
6. The admin creates the photographer accounts.
7. Update `docs/deployment.md` (bucket, binding, redeploy) and the readme (the new role and local photo folder).

## 13. Out of scope

Automatic expiry, per-photo delete, thumbnails in the Results table, cropping or face detection, queuing uploads while
offline, and letting the photographer check people in.
