# Task list load failure

When the task list cannot reach the API, the `/tasks` page replaces the list with an alert reading `Tasks could not be loaded.` instead of crashing or showing a stale list.

## Sub-features

- `error-client` shows the alert when a client-side navigation to `/tasks` cannot reach the API.
- `error-ssr` shows the alert when a direct load of `/tasks` cannot reach the API from the web server.

## How to get to it (user POV)

- Choose `Open the project tasks` on `/` while the API is unreachable from the browser.
- Open `$WEB_URL/tasks` directly while the API is down.

## Driving it with verify.sh

Preconditions:

- Baseline state from the index.

- **Client-side failure.** Hydrate the home page, cut the browser off from the API, then navigate. Run `RUN_ID=<id> $V browser goto / block-api click link "Open the project tasks" expect-text "Tasks could not be loaded." snap tasks-error-client`. `tasks-error-client.aria.yml` is exactly `- alert: Tasks could not be loaded.` at `/tasks`, and no list `Tasks` is present.
- **Proof of cause.** Inspect the log. Run `grep -E 'net GET|console.error' /tmp/verify-hackmidwest/artifacts/<id>/browser.log | tail -3`. It shows `net GET <API_URL>/api/tasks -> FAILED net::ERR_CONNECTION_REFUSED` followed by the `Unable to load tasks` console error.
- **SSR failure.** Not drivable with this harness. `bun run dev` supervises the API and web together with `--kill-others`, so stopping the API also stops the web server. Report `error-ssr` as unverified with that reason.

## Gotchas

- `block-api` must come after `goto /`. Blocking before the home page loads has no effect on SSR and proves nothing extra.
- The alert has no accessible name. Use `expect-text`, not `expect alert`.
- `block-api` only intercepts browser requests. A direct `goto /tasks` after `block-api` still renders the list through SSR; that is expected, not a failure of the feature.
