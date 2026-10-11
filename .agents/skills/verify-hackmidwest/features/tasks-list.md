# Task list

The `/tasks` page shows every task in creation order as a row of the `Tasks` table, with a labeled, read-only checkbox whose checked state reflects whether the task is completed.

## Sub-features

- `list-ssr` renders the list on a direct page load, with the data fetched by the web server.
- `list-order` shows tasks in ascending creation order.
- `list-state` shows each task's completion state as a checked or unchecked checkbox named by the task title.
- `list-readonly` keeps the checkbox state unchanged when the user clicks it.

## How to get to it (user POV)

- Open `$WEB_URL/tasks` directly (bookmark, reload, or typed URL).

## Driving it with verify.sh

Preconditions:

- Baseline state from the index (seed task only).

- **Direct load.** Open the page by URL. Run `RUN_ID=<id> $V browser goto /tasks expect table "Tasks" snap tasks-list-direct`. `tasks-list-direct.aria.yml` has title `Tasks · Hack Midwest` and table `Tasks` with a header row (`Done`, `Task`) and one data row holding an unchecked checkbox `Build the Hack Midwest demo`, and `browser.log` has no `net GET` line between this run's `step goto "/tasks"` and `step snap` lines, which proves SSR served the data (the log is appended across runs).
- **Order.** Add two tasks, then reload. Run `RUN_ID=<id> $V api tasks-list-add-a POST /api/tasks '{"title":"Alpha"}'`, `RUN_ID=<id> $V api tasks-list-add-b POST /api/tasks '{"title":"Bravo"}'`, and `RUN_ID=<id> $V browser goto /tasks expect checkbox "Bravo" snap tasks-list-order`. The snapshot lists `Build the Hack Midwest demo`, `Alpha`, `Bravo` in that order.
- **Read-only.** Click a checkbox and re-snapshot. Run `RUN_ID=<id> $V browser goto /tasks click checkbox "Alpha" snap tasks-list-after-click`. `Alpha` is still unchecked (no `[checked]`).
- **Stored state.** Confirm against storage. Run `RUN_ID=<id> $V db tasks-list-rows "select id, title, completed from tasks order by id"`. Rows match the rendered order and every `completed` is `0`.

## Gotchas

- No user path can mark a task completed today: the API ignores `completed` on create and has no update route. A `[checked]` state can only be observed by a later feature; do not stage it by editing SQLite.
- `Loading tasks...` is the pending view. Wait for table `Tasks`, never a fixed sleep.
- The loader runs on every navigation. Reload with `goto` after an API mutation; the snapshot of an already-open page is stale.
- The order sub-feature mutates data. `down` and `up` before running another recipe that expects the baseline.
