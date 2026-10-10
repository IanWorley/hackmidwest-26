---
name: verify-hackmidwest
description: Launch and drive the Hack Midwest tasks app (TanStack Start web UI on top of an Elysia + SQLite API) in an isolated instance and capture proof that a feature works for a real user. Use when asked to verify, demo, screenshot, or prove a change to the web pages (/, /tasks) or the /api/tasks endpoints, beyond what unit tests show.
---

# Verify the Hack Midwest tasks app

The repo is a Bun monorepo: `apps/web` (TanStack Start, React, SSR) and `apps/api` (Elysia on Bun, Drizzle, SQLite file). The **primary surface is the web UI**; the **secondary surface is the HTTP API** at `/api/tasks`, which is currently the only way to create a task (the UI is read-only). There is no CLI and no auth.

Everything goes through one helper. Set `V` in each shell command; it works from anywhere inside the repo:

```sh
V="$(git rev-parse --show-toplevel)/.claude/skills/verify-hackmidwest/scripts/verify.sh"
```

| Command | What it does |
|---|---|
| `$V setup` | One-time: `bun install --frozen-lockfile`, plus Playwright 1.64.0 + Chromium in `~/.cache/verify-hackmidwest/tools` (outside the repo; `bun.lock` is untouched). |
| `$V up` | Migrate + seed a fresh SQLite file, start `bun run dev` on two free ports, wait until ready, print `RUN_ID` and the state. |
| `RUN_ID=… $V doctor` | Read-only health check of that instance. |
| `RUN_ID=… $V browser <steps…>` | Drive the web UI headlessly (step language below). |
| `RUN_ID=… $V api <name> <METHOD> <path> [json]` | Send one HTTP request to the API and save request + full response. |
| `RUN_ID=… $V db <name> "<sql>"` | Read-only SQL against the instance's database, saved as evidence. |
| `RUN_ID=… $V down` | Stop the instance's process group, delete scratch state, keep evidence. |
| `$V list` | Show live run IDs. |

Shell state does not persist between your tool calls, so pass `RUN_ID=<id>` on every command after `up`.

## Launch

```sh
$V setup                      # first time on a machine only
$V up                         # or RUN_ID=my-check $V up to choose the id
```

`up` is the repo's own documented dev flow (`db:migrate`, `db:seed`, `bun run dev`) with configuration supplied through the environment instead of `.env`:

- `API_PORT`, `WEB_ORIGIN=http://localhost:<web>`, `VITE_API_BASE_URL=http://localhost:<api>` use OS-assigned free ports. Shell env takes precedence over the root `.env` for both Bun's `--env-file` and Vite's `loadEnv`, so a developer's `.env` and their own `bun run dev` on 3000/3001 are never touched.
- `DB_PATH=/tmp/verify-hackmidwest/runs/<RUN_ID>/db.sqlite`, a fresh file seeded with exactly one task: id `1`, `Build the Hack Midwest demo`, not completed.
- The dev supervisor runs under `setsid`, so its PID is the process group `down` kills.

**Ready** means `up` printed `ready RUN_ID=…` followed by the state (`API_URL`, `WEB_URL`, `DB_PATH`, `ARTIFACTS`, `PGID`, `GIT_REV`). It waits for `GET $API_URL/api/tasks` to answer and `GET $WEB_URL/tasks` to serve `<title>Hack Midwest tasks</title>`, up to 90 s. On timeout it prints the dev log tail and tears itself down. The first `up` on a machine takes ~10 s; Vite's first SSR compile is the slow part.

Instances are isolated by port, database file, and process group, so several runs can live side by side. Do not point the helper at an instance it did not start (for example the developer's `bun run dev`); it only knows runs under `/tmp/verify-hackmidwest/runs/`.

## Doctor

```sh
RUN_ID=<id> $V doctor
```

Prints `ok` / `FAIL` per check and exits non-zero on any failure: process group alive, both ports owned by **this** run's process group (not some other listener), API returns a JSON array, web serves the app title, database file exists, checkout `HEAD` equals the rev at launch. It also prints how many paths the working tree has changed; the dev server hot-reloads edits, so a running instance reflects uncommitted changes. Run doctor first whenever a step fails unexpectedly. If it fails, `down` and `up` again rather than repairing a half-dead instance.

## Drive

### Web UI: `$V browser <steps…>`

Each invocation opens a fresh headless Chromium page (no cookies or state carried over) and runs the steps in order. Selectors are ARIA role + exact accessible name.

| Step | Effect |
|---|---|
| `goto <path>` | Open `$WEB_URL<path>` and wait for network idle, which means hydrated. |
| `click <role> <name>` | Click the element, e.g. `click link "Open the project tasks"`. |
| `expect <role> <name>` | Wait (up to 15 s) until it is visible, e.g. `expect list "Tasks"`. |
| `expect-text <text>` | Wait until the exact text is visible. Use it for elements without a name, such as the error alert. |
| `block-api` | Abort every browser request to `$API_URL` from now on (the API is the network boundary). It does **not** affect SSR fetches made by the web server. |
| `snap <name>` | Write `<name>.aria.yml` (ARIA tree with URL and title header) and `<name>.png` (full page). |

Any failing step exits 1 and saves `failure-<ts>.png`. An unknown step or a missing argument exits 2 with a usage line before the browser starts. Every step, the URL after it, every browser request to the API (`net GET …/api/tasks -> 200`), and every console error are appended to `$ARTIFACTS/browser.log`.

Stable handles in the app today: link `Open the project tasks` (on `/`), list `Tasks` (on `/tasks`), one checkbox per task named by its title (`[checked]` in the ARIA snapshot when completed), alert text `Tasks could not be loaded.`, pending text `Loading tasks...`, document title `Hack Midwest tasks`.

### API: `$V api` and `$V db`

```sh
RUN_ID=<id> $V api create-ok POST /api/tasks '{"title":"Ship it"}'
RUN_ID=<id> $V api list GET /api/tasks
RUN_ID=<id> $V db rows "select id, title, completed from tasks order by id"
```

The API has exactly `GET /api/tasks` and `POST /api/tasks` (body `{"title": string 1..120}`). `db` opens the file with `sqlite3 -readonly`; never write to the database directly. Mutate only through the API.

## Evidence

All proof lands in `/tmp/verify-hackmidwest/artifacts/<RUN_ID>/` and survives `down`: `*.aria.yml`, `*.png`, `*.http.txt`, `*.db.txt`, `browser.log`, plus `dev.log` and `setup.log` copied there at teardown. Name artifacts after the feature step (`create-task-ui.png`, not `shot1.png`). Proof standards:

- **Real user path.** Drive the browser through visible links and roles, and the API through its public routes. Never call internal functions, never edit SQLite to stage data, never add test-only endpoints.
- **Action and result.** Capture the state before and after an action (two `snap`s, or a `browser.log` that shows the step and the resulting URL and request).
- **Side effects.** A 201 is not proof that a task exists. Pair it with a `db` row and with the task rendered on `/tasks`.
- **Mocks only at the boundary.** `block-api` is acceptable because the API is a separate process behind HTTP. Nothing else is stubbed.
- **Report what you could not reach.** If an entry point in the feature map was not driven, say so with the reason. Never report it as verified through a different path.

## Cleanup

```sh
RUN_ID=<id> $V down
```

`down` sends SIGTERM to the run's process group, waits up to 10 s, then SIGKILLs it. The API under `bun --watch` releases its port on SIGTERM but its watcher does not exit, so expect `down` to take ~10 s. It copies the logs into the artifacts dir and deletes `/tmp/verify-hackmidwest/runs/<RUN_ID>/` (database, state). It never kills by process name and never touches other runs. Run it after every attempt, including failed ones. `$V list` shows strays. Evidence directories are only removed by hand, and only when the user asks.

## Feature map

`features/README.md` indexes the user-facing features and their entry points. Read it before driving, and drive every entry point a feature lists. Keep it current with `/maintain-verification-skill` when routes, roles, or endpoints change.
