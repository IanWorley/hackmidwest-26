---
name: verify-hackmidwest
description: Launch and drive the Hack Midwest app (TanStack Start web UI on top of an Elysia + SQLite API, plus a separate agent API) in an isolated instance and capture proof that a feature works for a real user. Use when asked to verify, demo, screenshot, or prove a change to the web pages (/, /tasks, /conditions, /facilities, /facilities/<id>), the /api/tasks, /api/facilities, recommendation endpoints (/api/facilities/:id/recommendations, /api/recommendations/:id, /api/recommendations/:id/replay), decision endpoints (/api/recommendations/:id/decisions, /api/facilities/:id/decisions, /api/decisions/:id/verify, /api/decisions/:id/directives), notification endpoints (/api/recommendations/:id/notifications/preview, /api/decisions/:id/notifications, /api/decisions/:id/dispatch), the temporary /api/nws/live NWS pull, the /api/map endpoint, the temporary /api/flood/live flood pull, the agent API, or storage-only schema changes (add-only triggers, CHECK constraints), beyond what unit tests show.
---

# Verify the Hack Midwest app

The repo is a Bun monorepo: `apps/web` (TanStack Start, React, SSR), `apps/api` (Elysia on Bun, Drizzle, SQLite file), and `apps/agent-api` (Elysia on Bun, for agent and AI callers; it reads tasks from `apps/api` over HTTP and has no storage of its own). The **primary surface is the web UI**; the **secondary surface is the HTTP API** at `/api/tasks`, `/api/facilities`, the recommendation routes, the decision routes, and `/api/map` (plus the temporary live NWS pull at `/api/nws/live` and live flood pull at `/api/flood/live`), which is currently the only way to create a task, evaluate a recommendation, or record a decision (the UI is read-only). The agent API is a third, independent HTTP surface with `GET /health`, `GET /tasks/summary`, `POST /recommendations/:id/narrate`, and `POST /facilities/:id/run`. There is no CLI and no auth.

Everything goes through one helper. Set `V` in each shell command; it works from anywhere inside the repo:

```sh
V="$(git rev-parse --show-toplevel)/.agents/skills/verify-hackmidwest/scripts/verify.sh"
```

| Command | What it does |
|---|---|
| `$V setup` | One-time: `bun install --frozen-lockfile`, plus Playwright 1.64.0 + Chromium in `~/.cache/verify-hackmidwest/tools` (outside the repo; `bun.lock` is untouched). |
| `$V up` | Migrate + seed a fresh SQLite file, start `bun run dev` on three free ports (API, web, agent API), wait until ready, print `RUN_ID` and the state. `STORAGE=broken $V up` starts the same app on a file that is not a database, so every API query fails. |
| `RUN_ID=… $V doctor` | Read-only health check of that instance. |
| `RUN_ID=… $V browser <steps…>` | Drive the web UI headlessly (step language below). |
| `RUN_ID=… $V api <name> <METHOD> <path> [json]` | Send one HTTP request to the API and save request + full response. |
| `RUN_ID=… $V agent <name> <METHOD> <path> [json]` | Same as `api`, against the agent API. |
| `RUN_ID=… $V db <name> "<sql>"` | Read-only SQL against the instance's database, saved as evidence. |
| `RUN_ID=… $V db-reject <name> "<write-sql>" "<expected-error>"` | Run one write against a `.backup` snapshot of the database and exit `0` only if SQLite rejects it with that message and the snapshot is unchanged. The instance's database is never written. |
| `RUN_ID=… $V down` | Stop the instance's process group, delete scratch state, keep evidence. |
| `RUN_ID=… $V publish <pr> [summary.md]` | Push this run's evidence to the `verification-evidence` branch and comment on the PR with the screenshots embedded. Works after `down`. |
| `$V list` | Show live run IDs. |

Shell state does not persist between your tool calls, so pass `RUN_ID=<id>` on every command after `up`.

## Launch

```sh
$V setup                      # first time on a machine only
$V up                         # or RUN_ID=my-check $V up to choose the id
```

`up` is the repo's own documented dev flow (`db:migrate`, `db:seed`, `bun run dev`) with configuration supplied through the environment instead of `.env`:

- `API_PORT`, `AGENT_API_PORT`, `WEB_ORIGIN=http://localhost:<web>`, `VITE_API_BASE_URL=http://localhost:<api>`, `TASKS_API_URL=http://localhost:<api>` use OS-assigned free ports. Shell env takes precedence over the root `.env` for both Bun's `--env-file` and Vite's `loadEnv`, so a developer's `.env` and their own `bun run dev` on 3000/3001 are never touched.
- `DB_PATH=/tmp/verify-hackmidwest/runs/<RUN_ID>/db.sqlite`, a fresh file seeded with exactly one task (id `1`, `Build the Hack Midwest demo`, not completed) and the demo facility fixture: 4 facilities, 29 employees, one status event each. `GET /api/facilities` and the `/facilities` page serve the facilities; no endpoint serves the rosters yet.
- `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` are exported empty, which the agent API reads as unset. Every run narrates with the template layer and never calls a model, even when the developer's `.env` holds a key. `run.env` records this as `LLM=template`.
- With `STORAGE=broken`, `up` skips migrate and seed and writes a one-line text file at `DB_PATH` instead. The API starts, and every query fails with `SQLITE_NOTADB`. Use it only for recipes that need a storage failure. No real database is edited.
- The dev supervisor starts in its own session (`setsid` on Linux; perl's `POSIX::setsid` on macOS, which ships no `setsid`), so its PID is the process group `down` kills.

**Ready** means `up` printed `ready RUN_ID=…` followed by the state (`API_URL`, `WEB_URL`, `AGENT_API_URL`, `DB_PATH`, `STORAGE`, `EXPECTED_STATUS`, `LLM`, `ARTIFACTS`, `PGID`, `GIT_REV`). It waits until `GET $API_URL/api/tasks` and `GET $WEB_URL/tasks` both answer with `EXPECTED_STATUS` (`200`, or `500` with `STORAGE=broken`) and the page serves `<title>Tasks · Hack Midwest</title>`, and `GET $AGENT_API_URL/health` answers `200` (it has no storage, so `STORAGE=broken` does not change it), up to 90 s. On timeout it prints the dev log tail and tears itself down. The first `up` on a machine takes ~10 s; Vite's first SSR compile is the slow part.

Instances are isolated by port, database file, and process group, so several runs can live side by side. Do not point the helper at an instance it did not start (for example the developer's `bun run dev`); it only knows runs under `/tmp/verify-hackmidwest/runs/`.

## Doctor

```sh
RUN_ID=<id> $V doctor
```

Prints `ok` / `FAIL` per check and exits non-zero on any failure: process group alive, all three ports owned by **this** run's process group (not some other listener; found with `ss`, or `lsof` where `ss` is missing), API returns a JSON array, web serves the `/tasks` page title, agent API health answers `200`, database file exists, checkout `HEAD` equals the rev at launch. It also prints how many paths the working tree has changed; the dev server hot-reloads edits, so a running instance reflects uncommitted changes. Run doctor first whenever a step fails unexpectedly. If it fails, `down` and `up` again rather than repairing a half-dead instance.

## Drive

### Web UI: `$V browser <steps…>`

Each invocation opens a fresh headless Chromium page (no cookies or state carried over) and runs the steps in order. Selectors are ARIA role + exact accessible name.

| Step | Effect |
|---|---|
| `goto <path>` | Open `$WEB_URL<path>` and wait for network idle, which means hydrated. |
| `click <role> <name>` | Click the element, e.g. `click link "View conditions"`. |
| `expect <role> <name>` | Wait (up to 15 s) until it is visible, e.g. `expect table "Tasks"`. |
| `expect-text <text>` | Wait until the exact text is visible. Use it for elements without a name, such as the error alert. It always searches the whole page and ignores `within`. |
| `expect-focus <role> <name>` | Wait until that element has keyboard focus, e.g. `expect-focus combobox "Posture instead"` after an invalid submit. It respects `within`. |
| `expect-focus-text <text>` | Wait until the focused element's trimmed text is exactly `<text>`, for focus targets without a role, such as a status notice. |
| `press <key>` | Press one key on whatever has focus, e.g. `press Tab` or `press Space` (Playwright key names). Use it to prove keyboard operation. |
| `wait <seconds>` | Keep the page open for that long, e.g. `wait 70`. Use it to prove that an open page refreshes on its own; pair it with an API mutation run from another shell during the wait. |
| `block-api` | Abort every browser request to `$API_URL` from now on (the API is the network boundary). It affects only the current tab, and it does **not** affect SSR fetches made by the web server. |
| `unblock-api` | Undo `block-api` in the current tab, so a retry after a dropped connection reaches the API. |
| `fill <label> <text>` | Type into the control with that exact label, e.g. `fill "Reason" "County reports ice."`. |
| `select <label> <option>` | Choose the option with that exact text in the labeled select, e.g. `select "Recorded by" "Dana Whitfield, County Executive Director"`. |
| `tab <name>` | Switch to the named tab, opening it on first use. Steps start in tab `main`. A second tab acts as a second person, so one run can stage a conflict. Its log lines carry `[<name>]`. |
| `within <role> <name>` | Narrow `click`, `expect`, `expect-focus`, `fill`, and `select` to one region, e.g. `within form "Override the recommendation"` when the page has two `Reason` fields. `goto`, `tab`, and `within-page` widen it back to the whole page. |
| `within-page` | Undo `within`. |
| `snap <name>` | Write `<name>.aria.yml` (ARIA tree with URL and title header) and `<name>.png` (full page). |

Any failing step exits 1 and saves `failure-<ts>.png`. An unknown step or a missing argument exits 2 with a usage line before the browser starts. Every step, the URL after it, every browser request to the API (`net GET …/api/tasks -> 200`) and to the radar tile host, and every console error are appended to `$ARTIFACTS/browser.log`.

Stable handles in the app today: navigation `Main` in the header on every page, with links `Hack Midwest` (to `/`), `Conditions` (to `/conditions`), and `Facilities` (to `/facilities`), and no `Tasks` link (the task list is reached only by URL); on `/`, heading `Facility standing`, status `Decisions needed: <n>`, table `Facility standing` with one row per facility whose name is a link to `/facilities/<id>` and whose cells show the posture in effect (with `Recommended: <posture>` when the shown recommendation differs), the decide-by countdown (`Decide in …`, `Decision overdue`, or `—`), and `Decision needed`, the decision status (`Accepted`, `Overridden`, `Deferred`, or `Missed decision`), or `—`, link `View conditions` (to `/conditions`), alert text `Facility standing could not be loaded.`, and pending text `Loading facility standing...`; table `Tasks` (on `/tasks`), with one row per task and one checkbox per task named by its title (`[checked]` in the ARIA snapshot when completed); alert text `Tasks could not be loaded.`; pending text `Loading tasks...`; table `Facilities` (on `/facilities`), with one row per facility whose name is a link to `/facilities/<id>` and whose hazards are list items (`Winter storm`, `High wind`, `Air quality`, `Flood`); heading named by the facility on `/facilities/<id>`, followed by the decision screen (headings `Recommendation`, `Decide`, `Directives` once an accept or override is current, and `Decision history`; button `Re-evaluate`; buttons `Accept`, `Override`, `Defer`; selects `Recorded by`, `Reason category`, `Posture instead`, `Re-check in`, `Applies to`, `Directive`; textbox `Reason`; table `Decision history`); on `/conditions`, heading `Conditions`, toolbar `Map layers` with toggle buttons `Alerts`, `Air quality`, `Radar` (`[pressed]` when on, mirrored in `?layers=`), list `Posture legend`, one button per facility pin named by the facility, one tooltip per pin with its name, the posture in effect, `Recommended: <posture>` after an override that changed it, a decision status (`Accepted`, `Overridden`, `Deferred`, `Missed decision`) or countdown (`Decide in …`, `Decision overdue`), and `As of <time> UTC`, `Modeled AQI <value> · <category>` in each tooltip while `Air quality` is on, a popup link `Open <facility name>` after choosing a pin, the notice `Live alerts and air quality are unavailable. Facility standings are current.` when live conditions fail, alert text `Conditions could not be loaded.`, and pending texts `Loading conditions...` and `Loading map...`; text `Facility not found.` for an unknown id; alert text `Facilities could not be loaded.` and `Facility could not be loaded.` (on `/facilities/<id>`); pending texts `Loading facilities...` and `Loading facility...`; document title `Hack Midwest` on `/`, `Tasks · Hack Midwest` on `/tasks`, `Facilities · Hack Midwest` on `/facilities`, `Conditions · Hack Midwest` on `/conditions`, `<facility name> · Hack Midwest` on a facility page, `Facility not found · Hack Midwest` for an unknown or malformed id, and `Facility could not be loaded · Hack Midwest` when the facility API fails.

### API: `$V api` and `$V db`

```sh
RUN_ID=<id> $V api create-ok POST /api/tasks '{"title":"Ship it"}'
RUN_ID=<id> $V api list GET /api/tasks
RUN_ID=<id> $V db rows "select id, title, completed from tasks order by id"
```

The API has exactly `GET /api/tasks`, `POST /api/tasks` (body `{"title": string 1..120}`), `GET /api/facilities`, `GET /api/facilities/:id` (decimal positive integer id, `422` for `0x1` or `1e0`, `404` past the safe-integer range; `404 {"message":"Facility not found"}` for an unknown one), `POST /api/facilities/:id/recommendations` (optional body `{"asOf": "<ISO instant>"}`), `GET /api/facilities/:id/recorders` (the facility's decision maker, then its backup), `GET /api/facilities/:id/buildings` (each building with its employees' ids and names), `GET /api/facilities/:id/facility-date` (`{facilityDate, rollsOverAt, currentDecisionId}`, see [decision-screen](features/decision-screen.md)), `GET /api/facilities/:id/recommendations/latest`, `GET /api/recommendations/:id`, `GET /api/recommendations/:id/replay` (see [recommendations](features/recommendations.md)), `GET /api/map` (every facility's standing and live AQI plus the active NWS alerts as GeoJSON; alerts and AQI are cached for 60 s; see [map API](features/map-api.md)), `POST /api/recommendations/:id/decisions`, `GET /api/facilities/:id/decisions`, `GET /api/decisions/:id/verify` (see [decisions](features/decisions.md)), `GET /api/recommendations/:id/notifications/preview`, `GET /api/decisions/:id/notifications`, `POST /api/decisions/:id/dispatch` (body `{"packageHash"}` from the notifications read; `409 {"conflict",…}`, including `package_changed`; see [notifications](features/notifications.md)), `POST` and `GET /api/decisions/:id/directives` (see [directives](features/directives.md)), the temporary `GET /api/nws/live?lat=&lon=`, which calls api.weather.gov live, and the temporary `GET /api/flood/live?lat=&lon=&gauge=`, which calls api.weather.gov and api.water.noaa.gov live. The agent API has exactly `GET /health`, `GET /tasks/summary`, `POST /recommendations/:id/narrate` (same id rules as the API; returns `{template, narrated}` and passes through the API's `404`), and `POST /facilities/:id/run` (same id rules; evaluates, previews notifications, and narrates, then returns the three steps; never calls the decision or dispatch routes, though its evaluate can make the API record its missed-deadline `no_decision` row like any evaluation; see [agent API](features/agent-api.md)); drive it with `RUN_ID=<id> $V agent <name> <METHOD> <path>`. `db` opens the file with `sqlite3 -readonly`; never write to the database directly. Mutate only through the API. The exceptions are staging recommendations for the decisions and directives recipes, which need a fixed posture, a `decideBy` far in the future, and for directives a known facility day, recommendations the recommendations recipe must place relative to the clock, for its missed-deadline, lapsed-deferral, and out-of-order steps, the decision-screen recipe's earlier-day recommendation (which the map API, conditions, and home page recipes reuse), which is an `asOf` preview from the day before copied as a live row with its hash recomputed, because a live evaluation always lands on the current facility day, one past-deadline recommendation for the agent API recipe's missed-deadline step, and the directives recipe's final simulated tamper. Each recipe says exactly how.

A storage-only change (a new table, trigger, or `CHECK`) has no web or HTTP path until a route uses it. Prove it with `db-reject`, which pairs the write, the expected error, the exit code, and an unchanged-snapshot check in one `*.db.txt` transcript:

```sh
RUN_ID=<id> $V db-reject storage-status-events-delete "delete from employee_status_events where id = 1" "employee_status_events is add-only: events cannot be deleted"
```

It proves rejections only. A write the schema accepts prints `verdict> FAIL` and exits `1`.

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

`down` sends SIGTERM to the run's process group, waits up to 10 s, then SIGKILLs it. The API under `bun --watch` releases its port on SIGTERM but its watcher may not exit, so `down` can take up to 10 s. It copies the logs into the artifacts dir and deletes `/tmp/verify-hackmidwest/runs/<RUN_ID>/` (database, state). It never kills by process name and never touches other runs. Run it after every attempt, including failed ones. `$V list` shows strays. Evidence directories are only removed by hand, and only when the user asks.

## Attach proof to the PR

Every PR in this repo carries proof that the change works (see `AGENTS.md`). After `down`, publish the run.

```sh
RUN_ID=<id> $V publish <pr-number> /tmp/proof-summary.md
```

- Write the summary file first. One short paragraph per screenshot or transcript, saying which feature-map entry it proves and what the reader should see in it.
- `publish` commits the evidence files (`*.png`, `*.aria.yml`, `*.http.txt`, `*.db.txt`, `browser.log`, `run.env`) under `pr-<n>/<RUN_ID>/` on the `verification-evidence` branch. It uses a private git index, so it never changes any checkout or the PR branch.
- It then posts one PR comment with each screenshot embedded and links to the transcripts. The comment text is also saved as `proof-comment.md` in the artifacts dir.
- `verification-evidence` never merges and CI ignores it. If the push fails because another publish raced it, rerun `publish`.
- Publish one run per PR update that changes behavior. Do not publish a run whose doctor failed or whose recipe step failed, unless the comment says so.

## Feature map

`features/README.md` indexes the user-facing features and their entry points. Read it before driving, and drive every entry point a feature lists. Keep it current with `/maintain-verification-skill` when routes, roles, or endpoints change.
