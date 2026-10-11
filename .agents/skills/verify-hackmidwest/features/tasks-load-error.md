# Task list load failure

When the task list cannot reach the API, or the API answers with its generic error, the `/tasks` page replaces the list with an alert reading `Tasks could not be loaded.` instead of crashing or showing a stale list.

## Sub-features

- `error-ssr` shows the alert when a direct load of `/tasks` cannot reach the API from the web server.
- `error-api-500` returns `500` with body `{"message":"Internal server error"}` from `GET` and `POST /api/tasks` when storage fails, and `/tasks` shows the alert on a direct load.

## How to get to it (user POV)

- Open `$WEB_URL/tasks` directly while the API is down.
- Open `$WEB_URL/tasks` directly while the API's storage is failing.
- Send `GET` or `POST /api/tasks` to `$API_URL` while the API's storage is failing.

## Driving it with verify.sh

Preconditions:

- Baseline state from the index.

- **SSR failure.** Not drivable with this harness. `bun run dev` supervises the API and web together with `--kill-others`, so stopping the API also stops the web server. Report `error-ssr` as unverified with that reason.
- **API storage failure.** This needs its own instance. Run `STORAGE=broken RUN_ID=<id> $V up`; the state shows `STORAGE=broken` and `EXPECTED_STATUS=500`.
  - API. Run `RUN_ID=<id> $V api tasks-error-api-get GET /api/tasks` and `RUN_ID=<id> $V api tasks-error-api-post POST /api/tasks '{"title":"Never stored"}'`. Both are `500 Internal Server Error` with body exactly `{"message":"Internal server error"}`, and neither shows driver text.
  - Direct load. Run `RUN_ID=<id> $V browser goto /tasks expect-text "Tasks could not be loaded." snap tasks-error-api-ssr`. The snapshot's main region holds only `- alert: Tasks could not be loaded.`
  - Cause. `dev.log` shows `TaskStorageError` with `SQLITE_NOTADB` for each request. `down` this instance before running any baseline recipe.

## Gotchas

- A `STORAGE=broken` instance has no seed task and cannot store one. Never run a baseline recipe against it.
- The alert has no accessible name. Use `expect-text`, not `expect alert`.
- No page links to `/tasks`, so there is no client-side navigation to it to fail. Only the direct load is drivable.
