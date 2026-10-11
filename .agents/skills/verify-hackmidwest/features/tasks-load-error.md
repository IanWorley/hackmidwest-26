# Task list load failure

When the task list cannot reach the API, or the API answers with its generic error, the `/tasks` page replaces the list with an alert reading `Tasks could not be loaded.` instead of crashing or showing a stale list.

## Sub-features

- `error-client` shows the alert when a client-side navigation to `/tasks` cannot reach the API.
- `error-ssr` shows the alert when a direct load of `/tasks` cannot reach the API from the web server.
- `error-api-500` returns `500` with body `{"message":"Internal server error"}` from `GET` and `POST /api/tasks` when storage fails, and `/tasks` shows the alert on a direct load and on client-side navigation.

## How to get to it (user POV)

- Choose `Open the project tasks` on `/` while the API is unreachable from the browser.
- Open `$WEB_URL/tasks` directly while the API is down.
- Open `$WEB_URL/tasks` directly, or choose `Open the project tasks` on `/`, while the API's storage is failing.
- Send `GET` or `POST /api/tasks` to `$API_URL` while the API's storage is failing.

## Driving it with verify.sh

Preconditions:

- Baseline state from the index.

- **Client-side failure.** Hydrate the home page, cut the browser off from the API, then navigate. Run `RUN_ID=<id> $V browser goto / block-api click link "Open the project tasks" expect-text "Tasks could not be loaded." snap tasks-error-client`. `tasks-error-client.aria.yml` is at `/tasks`, its main region holds only `- alert: Tasks could not be loaded.`, and no table `Tasks` is present.
- **Proof of cause.** Inspect the log. Run `grep -E 'net GET|console.error' /tmp/verify-hackmidwest/artifacts/<id>/browser.log | tail -3`. It shows `net GET <API_URL>/api/tasks -> FAILED net::ERR_CONNECTION_REFUSED`, then `console.error Failed to load resource: net::ERR_CONNECTION_REFUSED`, then `console.error %o`. The log records the console format string, not the `Unable to load tasks` error it formats.
- **SSR failure.** Not drivable with this harness. `bun run dev` supervises the API and web together with `--kill-others`, so stopping the API also stops the web server. Report `error-ssr` as unverified with that reason.
- **API storage failure.** This needs its own instance. Run `STORAGE=broken RUN_ID=<id> $V up`; the state shows `STORAGE=broken` and `EXPECTED_STATUS=500`.
  - API. Run `RUN_ID=<id> $V api tasks-error-api-get GET /api/tasks` and `RUN_ID=<id> $V api tasks-error-api-post POST /api/tasks '{"title":"Never stored"}'`. Both are `500 Internal Server Error` with body exactly `{"message":"Internal server error"}`, and neither shows driver text.
  - Direct load. Run `RUN_ID=<id> $V browser goto /tasks expect-text "Tasks could not be loaded." snap tasks-error-api-ssr`. The snapshot's main region holds only `- alert: Tasks could not be loaded.`
  - Client navigation. Run `RUN_ID=<id> $V browser goto / click link "Open the project tasks" expect-text "Tasks could not be loaded." snap tasks-error-api-client`. The snapshot shows the alert, and `browser.log` shows `net GET <API_URL>/api/tasks -> 500`.
  - Cause. `dev.log` shows `TaskStorageError` with `SQLITE_NOTADB` for each request. `down` this instance before running any baseline recipe.

## Gotchas

- A `STORAGE=broken` instance has no seed task and cannot store one. Never run a baseline recipe against it.
- `block-api` must come after `goto /`. Blocking before the home page loads has no effect on SSR and proves nothing extra.
- The alert has no accessible name. Use `expect-text`, not `expect alert`.
- `block-api` only intercepts browser requests. A direct `goto /tasks` after `block-api` still renders the list through SSR; that is expected, not a failure of the feature.
