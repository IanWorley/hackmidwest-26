# Hack Midwest tasks verification map

This directory is the maintained source for verifying the user-facing behavior of the Hack Midwest tasks app. Read this index before driving the app, then use the matching feature file as the recipe.

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
- Mutate data only through `POST /api/tasks`. Never write to SQLite directly. `db-reject` is the one exception: it writes only to a throwaway snapshot.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an ARIA snapshot and a screenshot (`snap`) with the page title in the snapshot header (`Hack Midwest tasks` on `/`, `Tasks · Hack Midwest` on `/tasks`).
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

- [Home page](./home-navigation.md) covers the landing link, the header navigation, and client-side navigation to the task list.
- [Task list](./tasks-list.md) covers the server-rendered `/tasks` page, its ordering, and completion state.
- [Create a task](./create-task.md) covers `POST /api/tasks`, its validation, and seeing the new task on `/tasks`.
- [Agent API](./agent-api.md) covers the separate agent API: its `GET /health` liveness and its `GET /tasks/summary` read of the tasks API over HTTP.
- [NWS live pull](./nws-live.md) covers the temporary `GET /api/nws/live` route: a live National Weather Service pull for one point, its range validation, and its 500 outside NWS coverage.
- [Storage invariants](./storage-invariants.md) covers the add-only triggers and `CHECK` constraints, proven with `db-reject` because no route serves those tables yet.
- [Task list load failure](./tasks-load-error.md) covers the error alert shown when the API is unreachable or its storage fails, and the API's generic 500.
