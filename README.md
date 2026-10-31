# FieldReports

Wyxan Field Reports assessment app: offline-first field reports with camera/gallery photos, unsaved draft recovery, local SQLite durability, a single-flight upload queue, and a server-backed review panel.

- **Mobile:** React Native CLI `0.88.1`, TypeScript, Android required (npm, not yarn; not Expo)
- **Backend:** Express + TypeScript + SQLite (`node:sqlite`) under `backend/`
- **Node:** `>= 22.11.0` (app `package.json` engines); backend requires Node.js 22+

---

## Architecture

```text
FieldReports/
  App.tsx                 # Cold-start SQLite, network listener, screen routing
  src/
    api/                  # HTTP client, API base URL, server-review refresh signal, media URLs
    components/           # Shared UI (header, buttons, report cards, Server Review)
    db/                   # op-sqlite schema, repositories, drafts, stale-job recovery
      migrations.ts       # v1 reports/photos/jobs; v2 report_drafts + report_draft_photos
      draftRepository.ts  # Singleton unsaved compose draft (description + photo rows)
      createLocalReport.ts# Atomic report + photos + upload_jobs (+ optional draft clear)
      recoverStaleJobs.ts # in_progress → pending on startup
    hooks/                # Screen logic (create form/drafts, saved list, settings reset)
    media/                # Camera/gallery, permissions, compression
    reports/              # Validation, photo storage, draft helpers, save/delete/reset
      draftReport.ts      # Persist/restore/remove draft description and photos
      photoStorage.ts     # App-owned DocumentDirectory/report-photos/ copies
      saveLocalReport.ts  # Validate → persist → createLocalReport (clears draft on success)
    screens/              # Create Report, Saved Reports (incl. Server Review), Settings
    upload/               # Single-flight worker, backoff, NetInfo kick
    theme/
  backend/                # Express API, SQLite metadata, uploads/ on disk
  android/                # Native app (debug cleartext HTTP for emulator)
```

**How drafts, reports, photos, and upload jobs relate**

| Entity | Role |
|--------|------|
| Unsaved draft | Singleton compose state (`report_drafts` / `report_draft_photos`). Survives app restart. **Does not** create an `upload_jobs` row and **does not** upload. |
| Saved report | Row in `reports` with a stable `idempotency_key`, status, and related `report_photos`. |
| Upload job | One `upload_jobs` row per saved report, created only when the user taps **Save**. |
| Photo files | App-owned files under `DocumentDirectory/report-photos/`. Draft photos and saved-report photos share that directory; picker/cache URIs are never stored as permanent paths. |

**Data flow (happy path)**

1. User enters a description and/or attaches photos on Create Report. Changes are written to the unsaved draft (see [Unsaved draft persistence](#unsaved-draft-persistence)); still no upload job.
2. Oversized photos are compressed until each file is **strictly under** 5 MB (`5 * 1024 * 1024` bytes).
3. On **Save**, validation runs. Durable draft photo files are reused when valid; otherwise photos are copied into `report-photos/`. A SQLite transaction creates the report, `report_photos`, and a pending `upload_jobs` row with one stable idempotency key, and clears the draft in the same transaction.
4. The single-flight upload worker posts multipart `POST /reports` with header `Idempotency-Key`.
5. On confirmed success, local status becomes `uploaded`. If Saved Reports is mounted, Server Review refetches from the backend (not from SQLite).

---

## Prerequisites

- Node.js 22.11+ and npm
- Android SDK / emulator (or device) for the required Android path
- Completed [React Native environment setup](https://reactnative.dev/docs/set-up-your-environment) for RN 0.88

---

## Install

From the repository root:

```sh
npm install
```

Backend dependencies:

```sh
cd backend
npm install
cd ..
```

---

## Backend

### Development server

```sh
cd backend
npm run dev
```

Default listen address: `http://localhost:3000`  
Override port: `PORT=4000 npm run dev` (`PORT` from `backend/src/config.ts`).

Other backend scripts:

| Command | Purpose |
|---------|---------|
| `npm run typecheck` | Typecheck without emit |
| `npm run build` | Compile to `backend/dist/` |
| `npm start` | Run `node dist/index.js` after build |

### Health check

```sh
curl -s http://localhost:3000/health
```

More API detail (multipart fields, chaos, reset blast radius): see [`backend/README.md`](backend/README.md).

---

## Mobile app (Android)

Use **three terminals**: backend, Metro, Android.

```sh
# Terminal A — backend
cd backend && npm run dev

# Terminal B — Metro
npm start

# Terminal C — Android emulator / device
npm run android
```

Debug APK only:

```sh
cd android && ./gradlew assembleDebug
```

### Emulator → host backend (`10.0.2.2`)

On Android, the default API base URL is:

`http://10.0.2.2:3000`

(see `DEFAULT_ANDROID_EMULATOR_BASE` in `src/api/config.ts`).

Debug builds enable cleartext HTTP (`usesCleartextTraffic` is `true` only for the `debug` build type in `android/app/build.gradle`). **Release builds keep cleartext disabled.**

iOS simulator default (if used): `http://localhost:3000`.

### Physical device — API base URL override (debug)

There is no separate env file. For a **debug** build talking to a backend on your LAN over plain HTTP, override the base URL by setting the Metro/global flag before the app loads:

```js
// e.g. near the top of index.js, before AppRegistry
global.__FIELDREPORTS_API_BASE_URL__ = 'http://<your-lan-ip>:3000';
```

`getApiBaseUrl()` in `src/api/config.ts` reads `global.__FIELDREPORTS_API_BASE_URL__` first (trailing slash stripped). Use your machine’s LAN IP reachable from the device; keep the backend listening on that host/port.

This LAN HTTP path is intended for **debug** builds (cleartext enabled). Release builds leave cleartext HTTP disabled; a release client would need HTTPS (or a cleartext policy change that this project does not enable).

Upload timeout: `UPLOAD_REQUEST_TIMEOUT_MS = 60_000`  
Soft health/list timeout: `HEALTH_REQUEST_TIMEOUT_MS = 8_000`

---

## Create report: photos and compression

| Rule | Implementation |
|------|----------------|
| Description required | Trimmed non-empty (`src/reports/validation.ts`) — enforced on **Save**, not while drafting |
| Photos | 1–5 (`MIN_PHOTOS` / `MAX_PHOTOS`) from camera or gallery — enforced on **Save** |
| Size | Each image must be strictly under `MAX_IMAGE_BYTES` (exactly 5 MB rejected) |
| MIME | JPEG, PNG, WebP, HEIC/HEIF, GIF |
| Large originals | Accepted, then compressed via `react-native-image-compression-kit` until on-disk size is under the limit |
| Persistence | Copied to `report-photos/` (as draft and/or on Save); picker/cache URIs are not stored as permanent paths |

Permissions: Android `CAMERA` and (API ≤ 32) `READ_EXTERNAL_STORAGE` as declared in `AndroidManifest.xml`.

---

## Unsaved draft persistence

Create Report keeps a **singleton** unsaved draft in local SQLite (migration v2: `report_drafts` + `report_draft_photos`, id fixed to `1`). Draft work is implemented in `src/db/draftRepository.ts`, `src/reports/draftReport.ts`, and `src/hooks/useCreateReportForm.ts`.

**Drafting does not enqueue an upload.** No `upload_jobs` row exists until a validated **Save** succeeds.

| Behavior | What the app does |
|----------|-------------------|
| Description | Debounced persist (~400 ms) via `persistDraftDescription` / `upsertDraftDescription`. Also flushed when the app becomes `background` or `inactive`. |
| Selected photos | New selections are copied into app-owned `report-photos/` and recorded in `report_draft_photos` (`persistDraftPhotos`). Already draft-persisted photos are not copied again. |
| Restore after restart | On Create Report mount, `loadReportDraft` reloads description + photos. Missing or size-mismatched files are dropped from the draft (metadata updated, best-effort unlink) and a recovery notice is shown. |
| Add / remove photos | Add updates the draft photo set. Remove reindexes remaining rows and deletes the removed draft-owned file when `draftPersisted` is true. Never touches saved `report_photos` files. |
| Save as report | `saveLocalReport` validates, reuses valid draft files when possible, then `createLocalReport` inserts report + `report_photos` + pending `upload_jobs` and clears draft rows **in the same transaction** (`clearDraft: true`). |
| Clear after successful Save | Draft SQLite rows are deleted in that create transaction. Compression temps are cleaned; reused draft photo files become the saved report’s permanent paths (not deleted). |
| Preserve on Save failure | If validation, storage, or the DB create fails, draft rows and draft-owned files remain so the user can retry. Only files newly copied during a failed non-reuse save attempt are cleaned up. |
| DB / cleanup | Draft metadata lives only in the draft tables. Global reset deletes draft rows and draft photo URIs, then best-effort wipes `report-photos/`. Per-report delete does not clear the compose draft. |

---

## Offline durability and upload queue

- **SQLite** (`@op-engineering/op-sqlite`): `reports`, `report_photos`, `upload_jobs`, `report_drafts`, `report_draft_photos`, versioned migrations.
- **Atomic create (on Save):** `createLocalReport` inserts report + photos + pending job (and clears the draft when requested) in one transaction.
- **Stale recovery:** on startup, `in_progress` jobs return to `pending` (`recoverStaleUploadJobs`); idempotency keys are never regenerated.
- **Worker:** single-flight (`kickUploadWorker`); kicks after save, cold start, connectivity regain (NetInfo), and manual Sync/Retry.
- **Retries:** bounded exponential backoff with jitter — `MAX_UPLOAD_ATTEMPTS = 8`, base `1000` ms, cap `5 * 60_000` ms (`src/upload/backoff.ts`).
- **Idempotency:** same `Idempotency-Key` on every attempt; backend returns `replayed: true` for duplicates without creating a second report.
- **Local photos** are not deleted after a successful upload.

### Force-quit / background limitation

There is **no** WorkManager / headless continuous upload after the process is killed.

- While the JS process is alive (foreground or typical background), the worker can run and schedule retries.
- After **force-quit**, durable state remains in SQLite (including any unsaved draft) + `report-photos/`. Uploads **resume on the next app launch** (startup recovery + `kickUploadWorker`), and again when the network returns or the user taps Sync/Retry. The Create Report draft is restored when that screen mounts.

Do not claim OS-level delivery continues while the app is force-stopped.

---

## Server Review and image previews

Server Review lives on the Saved Reports screen and is **server-backed only** (never built from local SQLite rows).

1. **List:** `GET /reports` via `listServerReports()` (in-flight requests are coalesced).
2. **Images:** for each listed report, `GET /reports/:id` loads `images[].url` (typically `/uploads/<filename>`).
3. **URL resolution:** `resolveServerImageUrl()` in `src/api/mediaUrl.ts` joins relative paths with `getApiBaseUrl()`; absolute `http(s)` URLs pass through. No hardcoded device IPs.
4. **Auto-refresh while mounted:** on upload `outcome === 'uploaded'` (initial or successful retry), the worker calls `requestServerReviewRefresh()` (`src/api/serverReviewRefresh.ts`). A **mounted** Saved Reports / Server Review subscriber immediately refetches. Failed or retry-scheduled outcomes do **not** refresh Server Review.
5. **When Server Review is not mounted:** opening Saved Reports always loads Server Review on mount (`loadServerReview`). The refresh generation counter still advances if a success happens while unmounted, but the screen does not need that counter to show fresh data — remount fetches again.
6. **Thumbnails:** fixed-size previews (`resizeMode="cover"`). Blank URLs are skipped. Load failures show a small fallback tile and do not crash the screen. The backend has no separate thumbnail endpoint; the preview still requests the served upload file.

Manual Reload on Saved Reports refreshes both the local list and Server Review.

---

## Chaos testing

Chaos is configured on the backend only (no in-app chaos UI). It applies to **new** uploads (unknown idempotency key) after validation and before durable writes. Idempotent replays skip chaos.

```sh
# Inspect
curl -s http://localhost:3000/admin/chaos

# Latency
curl -s -X PATCH http://localhost:3000/admin/chaos \
  -H "Content-Type: application/json" \
  -d '{"latencyMs": 3000}'

# Fail next N new uploads
curl -s -X PATCH http://localhost:3000/admin/chaos \
  -H "Content-Type: application/json" \
  -d '{"failNextN": 2}'

# Random failure rate 0..1
curl -s -X PATCH http://localhost:3000/admin/chaos \
  -H "Content-Type: application/json" \
  -d '{"failRate": 0.5}'

# Hang (no HTTP response) for new uploads — client times out at UPLOAD_REQUEST_TIMEOUT_MS
curl -s -X PATCH http://localhost:3000/admin/chaos \
  -H "Content-Type: application/json" \
  -d '{"hang": true}'

# Clear
curl -s -X PATCH http://localhost:3000/admin/chaos \
  -H "Content-Type: application/json" \
  -d '{"latencyMs":0,"failNextN":0,"failRate":0,"hang":false}'
```

---

## Deletion and reset

### Per-report delete (local only)

- Allowed for **pending** and **failed** only.
- Blocked while **uploading**; **uploaded** reports are not deleted locally (keeps consistency with the server copy).
- Removes the SQLite report (cascades `report_photos` + `upload_jobs`) and best-effort deletes that report’s local photo files.
- Does **not** clear the unsaved Create Report draft.
- Does **not** call any server delete API.

### Global reset (Settings → Reset all reports)

Requires confirmation. Ordering (`src/reports/resetAllReports.ts`):

1. Refuse if the upload worker is running or a job is `in_progress`.
2. Pause the worker.
3. **Server first:** `DELETE /admin/reset` (needs network). On server failure, **all local data is left intact** (saved reports, jobs, photos, and drafts).
4. **Local wipe** in one SQLite transaction: delete all `reports` (cascades `report_photos` and `upload_jobs`), then delete `report_draft_photos` and `report_drafts`. Collect report + draft photo URIs beforehand, then best-effort delete those files and wipe `report-photos/`.
5. Resume the worker.

| Scope | Deleted | Preserved |
|-------|---------|-----------|
| **Server** (`DELETE /admin/reset`) | Report + image metadata in backend SQLite; files under `backend/uploads/` (except `.gitkeep`); leftover `backend/tmp/` files | Chaos configuration (`chaos_config`) |
| **Local** (after server success) | Saved reports; pending/failed/succeeded upload jobs (via cascade); `report_photos` rows; unsaved draft rows; draft photo rows; best-effort local image files under `report-photos/` | `schema_migrations`; chaos is server-side only (unchanged by this wipe) |

Success is reported only when both server and local scopes complete. If the server reset succeeds but local DB wipe fails, the app surfaces a **partial** failure (server already cleared; local may still have data) and asks the user to retry Reset.

---

## Tests and typecheck

App (repo root):

```sh
npm run typecheck
npm test
```

Backend:

```sh
cd backend
npm run typecheck
```

Android debug build:

```sh
cd android && ./gradlew assembleDebug
```

---

## Manual assessment verification checklist

Use a running backend (`npm run dev` in `backend/`) and Android emulator (`npm start` + `npm run android`).

- [ ] Health: `curl -s http://localhost:3000/health` succeeds
- [ ] Create report with required description + 1–5 photos; Save succeeds offline-capable locally
- [ ] Leave Create Report mid-compose (description/photos), force-stop or kill the app, relaunch: draft restores; Save still does not run until the user confirms
- [ ] Large gallery/camera image compresses and saves; each persisted file is under 5 MB
- [ ] Permission denial shows a clear message; granting later allows capture/selection again
- [ ] Saved Reports shows local status badges (Pending / Uploading / Uploaded / Failed)
- [ ] With network up, pending reports upload; Server Review gains the new report without leaving the screen (or after Sync)
- [ ] Server Review shows description, image count, and image thumbnails from `/uploads/...` via the configured base URL
- [ ] Broken/missing image URL shows a fallback tile; screen does not crash
- [ ] Chaos `failNextN` / latency: local report survives; retries eventually succeed; no duplicate server rows for the same idempotency key
- [ ] Chaos `hang`: client times out (~60s), retries with the same key, reconciles without duplicates
- [ ] Force-stop during/after save: relaunch restores local reports/photos; pending uploads resume after launch
- [ ] Force-stop mid-upload: stale `in_progress` recovers to pending and retries with the same key
- [ ] Delete works for pending/failed only; uploading shows blocked messaging; uploaded has no delete
- [ ] Settings reset: confirmation, server-first wipe, local reports/jobs/photos **and drafts** wiped, chaos unchanged; success only when both scopes finish
- [ ] `npm run typecheck`, `npm test`, and `cd android && ./gradlew assembleDebug` all succeed

---

## Related docs

- Backend API, chaos semantics, and reset scope: [`backend/README.md`](backend/README.md)
