# Hack Midwest verification map

This directory is the maintained source for verifying the user-facing behavior of the Hack Midwest app. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- `V="$(git rev-parse --show-toplevel)/.agents/skills/verify-hackmidwest/scripts/verify.sh"` in every shell command.
- `$V setup` has run once on this machine.
- `$V up` printed `ready RUN_ID=<id>`, and every later command is prefixed with `RUN_ID=<id>`.
- `RUN_ID=<id> $V doctor` exits `0`.
- The database holds only the seed data: one task (id `1`, `Build the Hack Midwest demo`, not completed) and the demo facility fixture (4 facilities, 29 employees, one status event each). A fresh `up` guarantees this; a reused instance may not.
- Never drive an instance that was not started by this verification run.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise. When a previous recipe mutated data, `down` and `up` again.
- Prefer ARIA roles and exact accessible names. Use `expect-text` only for elements that have no accessible name.
- Treat every command as literal. Keep quoted names, paths, and JSON unchanged.
- Run browser actions through `$V browser`, HTTP through `$V api`, stored-state checks through `$V db`, and schema rejections through `$V db-reject`.
- Mutate data only through `POST /api/tasks`, `POST /api/facilities/:id/recommendations`, `POST /api/recommendations/:id/decisions`, `POST /api/decisions/:id/directives`, `POST /api/decisions/:id/dispatch`, and `POST /api/employees/:id/status`. Never write to SQLite directly. Four exceptions: `db-reject` writes only to a throwaway snapshot, the [decisions](./decisions.md) and [directives](./directives.md) recipes stage recommendation rows with `sqlite3` because they need a fixed posture and a `decideBy` far in the future (the directives recipe also fixes each row's facility day), the directives recipe's last step edits a directive with `sqlite3` to show verify catching it, and the [recommendations](./recommendations.md) recipe stages recommendations whose `decideBy` or `evaluatedAt` it must place relative to the clock, for its missed-deadline, lapsed-deferral, and out-of-order steps.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an ARIA snapshot and a screenshot (`snap`) with the page title in the snapshot header (`Hack Midwest` on `/`, `Tasks · Hack Midwest` on `/tasks`, `Facilities · Hack Midwest` on `/facilities`).
- API proof includes the saved request, status line, headers, and body (`*.http.txt`).
- Mutation proof includes a read-only second view: a `db` row and the item rendered on `/tasks`.
- Storage proof is a `db-reject` transcript with `verdict> rejected` (`*.db.txt`).
- Name artifacts `<feature>-<step>` so each one maps back to a feature and entry point.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with verify.sh` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Home page](./home-navigation.md) covers the landing links, the header navigation, and client-side navigation to the task list.
- [Task list](./tasks-list.md) covers the server-rendered `/tasks` page, its ordering, and completion state.
- [Facility list and detail](./facilities-list.md) covers the server-rendered `/facilities` page, the link from each row to `/facilities/<id>`, the not-found page, and `GET /api/facilities` and `GET /api/facilities/:id`.
- [Decision screen](./decision-screen.md) covers the decision UI on `/facilities/<id>`: the live recommendation and countdown, Re-evaluate, Accept / Override / Defer with the Recorded-by select, directives, the standing decision across re-evaluation, the stale-view and failed-submit alerts, the earlier-day and backup notices, and `GET /api/facilities/:id/recorders`, `/buildings`, and `/facility-date`.
- [Facility personnel](./personnel.md) covers `/facilities/<id>/personnel`: the roster table, the status summary, its filters, the `Update status` dialog and its `POST /api/employees/:id/status`, the `Who's notified and why` link, the untimed-posture alert, its reload when a scheduled status takes effect or the day rolls over, and its not-found and load-error states.
- [Create a task](./create-task.md) covers `POST /api/tasks`, its validation, and seeing the new task on `/tasks`.
- [Agent API](./agent-api.md) covers the separate agent API: its `GET /health` liveness, its `GET /tasks/summary` read of the tasks API over HTTP, and `POST /recommendations/:id/narrate`, which phrases a stored rationale for a manager's email.
- [NWS live pull](./nws-live.md) covers the temporary `GET /api/nws/live` route: a live National Weather Service pull for one point, its range validation, and its 500 outside NWS coverage.
- [Recommendations](./recommendations.md) covers `POST /api/facilities/:id/recommendations` (live and as-of evaluation, the stored snapshot and its content hash, and the missed-deadline `no_decision` write), `GET /api/facilities/:id/recommendations/latest`, `GET /api/recommendations/:id`, and `GET /api/recommendations/:id/replay`.
- [Decisions](./decisions.md) covers `POST /api/recommendations/:id/decisions` (accept, override, defer, superseding, and its `409` and `422` answers), `GET /api/facilities/:id/decisions`, and `GET /api/decisions/:id/verify`.
- [Notifications](./notifications.md) covers `GET /api/recommendations/:id/notifications/preview`, `GET /api/decisions/:id/notifications`, the once-only `POST /api/decisions/:id/dispatch` with its lead times, its `409` bodies, and the dispatch rows on the verified chain.
- [Directives](./directives.md) covers `POST /api/decisions/:id/directives` (four scopes, issuer eligibility, unknown fields, the current-decision `409`s, and its `422` answers), `GET /api/decisions/:id/directives`, and directives in `GET /api/decisions/:id/verify`.
- [Personnel status](./personnel-status.md) covers `POST /api/employees/:id/status` (its `201`, `422`, and `404` answers) and `GET /api/facilities/:id/personnel` with each person's baseline, newest event, and effective status under the current decision and its directives.
- [Flood live pull](./flood-live.md) covers the temporary `GET /api/flood/live` route: live NWS flood warnings and an optional NWPS river gauge for one point, the flood cutoffs they cross, its gauge validation, and its 500 for an unknown gauge.
- [Storage invariants](./storage-invariants.md) covers the add-only triggers and `CHECK` constraints, proven with `db-reject` against writes that bypass the routes.
- [Task list load failure](./tasks-load-error.md) covers the error alert shown when the API is unreachable or its storage fails, and the API's generic 500.
