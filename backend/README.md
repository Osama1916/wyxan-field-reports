# Field Reports Backend

Simple Express + TypeScript + SQLite API for the Wyxan Field Reports assessment.

Persistent report metadata and idempotency keys live in SQLite (`data/fieldreports.sqlite`) via Node's built-in `node:sqlite` module. Uploaded images are stored on disk under `uploads/`.

## Requirements

- Node.js 22+ (for built-in `node:sqlite`)
- npm

## Install

```sh
cd backend
npm install
```

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Development server with reload (`tsx watch`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled production build (`node dist/index.js`) |
| `npm run typecheck` | Typecheck without emitting |

## Start (development)

```sh
npm run dev
```

Server listens on `http://localhost:3000` by default. Override with `PORT=4000 npm run dev`.

## Start (production)

```sh
npm run build
npm start
```

## What reset deletes

`DELETE /admin/reset` removes:

- All rows in the `reports` and `report_images` SQLite tables
- All image files in `uploads/` (except `.gitkeep`)
- Leftover temp files in `tmp/`

It does **not** change chaos simulation settings.

This endpoint only affects the **backend**. It does not touch the mobile app’s local SQLite (saved reports, upload jobs, or unsaved drafts). The app’s Settings → Reset all reports calls this API first, then wipes local data separately — see the root [`README.md`](../README.md) deletion/reset section.

## API

### `GET /health`

```sh
curl -s http://localhost:3000/health
```

### `POST /reports`

Multipart upload. Required:

- Header `Idempotency-Key` (non-empty)
- Field `description` (non-empty string)
- Field `images` — 1 to 5 image files, each **under** 5 MB

```sh
curl -s -X POST http://localhost:3000/reports \
  -H "Idempotency-Key: demo-key-001" \
  -F "description=Broken fence at north gate" \
  -F "images=@./sample1.jpg" \
  -F "images=@./sample2.jpg"
```

Successful create returns `201` with `{ replayed: false, report }`.

Repeating the same `Idempotency-Key` returns `200` with `{ replayed: true, report }` and does **not** create another report or store duplicate image files. Temporary uploads from the replay request are deleted.

### `GET /reports`

```sh
curl -s http://localhost:3000/reports
```

### `GET /reports/:id`

```sh
curl -s http://localhost:3000/reports/<report-id>
```

Image URLs in the response are served from `/uploads/<filename>`.

### `GET /admin/chaos`

```sh
curl -s http://localhost:3000/admin/chaos
```

Example response:

```json
{
  "latencyMs": 0,
  "failNextN": 0,
  "failRate": 0,
  "hang": false
}
```

### `PATCH /admin/chaos`

```sh
# Add 3s latency to upload handling
curl -s -X PATCH http://localhost:3000/admin/chaos \
  -H "Content-Type: application/json" \
  -d '{"latencyMs": 3000}'

# Fail the next 2 upload attempts (after validation)
curl -s -X PATCH http://localhost:3000/admin/chaos \
  -H "Content-Type: application/json" \
  -d '{"failNextN": 2}'

# Randomly fail ~50% of new uploads
curl -s -X PATCH http://localhost:3000/admin/chaos \
  -H "Content-Type: application/json" \
  -d '{"failRate": 0.5}'

# Hang forever (no HTTP response) for new uploads
curl -s -X PATCH http://localhost:3000/admin/chaos \
  -H "Content-Type: application/json" \
  -d '{"hang": true}'

# Clear all simulation flags
curl -s -X PATCH http://localhost:3000/admin/chaos \
  -H "Content-Type: application/json" \
  -d '{"latencyMs":0,"failNextN":0,"failRate":0,"hang":false}'
```

### `DELETE /admin/reset`

```sh
curl -s -X DELETE http://localhost:3000/admin/reset
```

## Failure simulation behavior

Chaos applies only to **new** `POST /reports` requests (unknown idempotency key), **after** multipart parsing and validation, and **before** any SQLite insert or permanent file move into `uploads/`.

| Setting | Effect |
|---------|--------|
| `latencyMs` | Wait N milliseconds before create/fail/hang |
| `failNextN` | Next N new uploads return HTTP 500; counter decrements |
| `failRate` | Probability `0..1` of HTTP 500 on each new upload |
| `hang` | Temp files are deleted; response is never sent |

Simulated failures and hangs never leave partial reports in SQLite or orphan files in `uploads/`. Rejected validation also deletes multer temp files under `tmp/`.

Idempotent replays (known key) skip chaos and return the stored report immediately.

## Android emulator note

From an Android emulator, the host machine is `http://10.0.2.2:3000`.

## Layout

```text
backend/
  data/fieldreports.sqlite   # created at runtime
  uploads/                   # durable image files
  tmp/                       # multer temp files (cleaned after each request)
  src/
    index.ts
    app.ts
    config.ts
    db.ts
    files.ts
    routes/
    middleware/
```
