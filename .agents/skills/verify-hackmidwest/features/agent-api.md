# Agent API

The agent API is a separate backend for agent and AI callers. It runs as its own process on its own port, next to the tasks API. It answers `GET /health` while it is serving requests, `GET /tasks/summary` with task counts it reads from the tasks API over HTTP, `POST /recommendations/:id/narrate` with a stored recommendation's rationale phrased for a manager's email, and `POST /facilities/:id/run` with a step-by-step log of an evaluate, a notification preview, and a narration. It never opens the database and never calls the API's decision or dispatch routes, so a run records no decision of its own. Its evaluate step is the API's evaluation, though, so it can make the API record its automatic missed-deadline `no_decision` row, as any evaluation does.

## Sub-features

- `agent-health-ok` returns `200` with body exactly `{"status":"ok"}`.
- `agent-health-separate` is served on `AGENT_API_URL`, not on the tasks API's port.
- `agent-health-storage-independent` still returns `200` when the tasks API's storage is failing.
- `agent-summary-ok` returns `200` with `{total, completed, open}` matching the tasks API's list.
- `agent-summary-follows-api` reflects a task created through `POST /api/tasks` on the next request.
- `agent-summary-api-failure` returns `500` with body exactly `{"message":"Internal server error"}` when the tasks API fails.
- `agent-narrate-ok` returns `200` with `{"template","narrated"}`, where `template` is exactly the stored recommendation's `snapshot.output.rationale`. Under `verify.sh`, which runs without a model, `narrated` equals `template`.
- `agent-narrate-not-found` returns `404` with body exactly `{"message":"Recommendation not found"}`, passed through from the API.
- `agent-narrate-malformed-id` returns `422` for an id such as `0x1`, like the API.
- `agent-run-ok` returns `200` with `{facilityId, recommendationId, steps}`. `steps` is exactly three entries in the order `evaluate`, `preview_notifications`, `narrate`, each `{tool, input, output, startedAt, durationMs}`. The evaluate output is the stored recommendation, the preview output is that recommendation's notification preview, and the narrate output is `{template, narrated}`.
- `agent-run-side-effects` leaves exactly one new `recommendations` row, no `notification_dispatches` rows, and no `decisions` row other than the API's missed-deadline `no_decision`.
- `agent-run-missed-deadline` makes the API record one `no_decision` decision, decided by the facility's backup, when the facility's previous recommendation passed its `decideBy` with no decision. It is the same row `POST /api/facilities/:id/recommendations` records. The run's log still holds only `evaluate`, `preview_notifications`, and `narrate`.
- `agent-run-not-found` returns `404` with body exactly `{"message":"Facility not found"}`, passed through from the API.
- `agent-run-malformed-id` returns `422` for an id such as `0x1`, like the API.

## How to get to it (user POV)

- Send `GET /health` to `$AGENT_API_URL`.
- Send `GET /tasks/summary` to `$AGENT_API_URL`.
- Send `POST /recommendations/<id>/narrate` to `$AGENT_API_URL` for a recommendation created through `POST /api/facilities/<id>/recommendations`.
- Send `POST /facilities/<id>/run` to `$AGENT_API_URL`.

## Driving it with verify.sh

Preconditions:

- Baseline state from the index (seed task only).

- **Health.** Ask the agent API whether it is up. Run `RUN_ID=<id> $V agent agent-health-ok GET /health`. Status `200 OK`; body is exactly `{"status":"ok"}`.
- **Separate port.** Ask the tasks API for the same path. Run `RUN_ID=<id> $V api agent-health-not-on-api GET /health`. Status `404 Not Found`, which shows the route is served only on the agent API's port.
- **Summary.** Read the summary. Run `RUN_ID=<id> $V agent agent-summary-ok GET /tasks/summary`. Status `200 OK`; body is exactly `{"total":1,"completed":0,"open":1}`.
- **Follows the API.** Create a task, then read the summary again. Run `RUN_ID=<id> $V api agent-summary-create POST /api/tasks '{"title":"Ask the agent"}'` (`201`), then `RUN_ID=<id> $V agent agent-summary-after-create GET /tasks/summary`. Body is exactly `{"total":2,"completed":0,"open":2}`. Run `RUN_ID=<id> $V db agent-summary-rows "select id, title, completed from tasks order by id"` to show the two rows the counts came from.
- **Narrate.** Create a recommendation, then narrate it. Run `RUN_ID=<id> $V api agent-narrate-create POST /api/facilities/1/recommendations` (`201`; note its `id`, `1` on a fresh instance), `RUN_ID=<id> $V api agent-narrate-record GET /api/recommendations/1`, then `RUN_ID=<id> $V agent agent-narrate-ok POST /recommendations/1/narrate`. Status `200 OK`; `template` equals the record's `snapshot.output.rationale`, and `narrated` equals `template`. Run `RUN_ID=<id> $V db agent-narrate-row "select id, facility_id, posture, json_extract(snapshot, '$.output.rationale') as rationale from recommendations order by id"` to show the stored row the narration came from.
- **Narrate unknown id.** Run `RUN_ID=<id> $V agent agent-narrate-not-found POST /recommendations/999999/narrate`. Status `404 Not Found`; body is exactly `{"message":"Recommendation not found"}`.
- **Narrate malformed id.** Run `RUN_ID=<id> $V agent agent-narrate-malformed-id POST /recommendations/0x1/narrate`. Status `422 Unprocessable Entity`.
- **Run.** Run `RUN_ID=<id> $V agent agent-run-ok POST /facilities/1/run`. Status `200 OK`; `facilityId` is `1`, `recommendationId` is the new row's id (`1` on a fresh instance, `2` after the narrate step), and `steps[].tool` is exactly `evaluate`, `preview_notifications`, `narrate`. `steps[0].output.id` and `steps[1].output.source.recommendationId` both equal `recommendationId`, `steps[2].output.template` equals `steps[0].output.snapshot.output.rationale`, and with no `OPENROUTER_API_KEY` `narrated` equals `template`. Then run `RUN_ID=<id> $V db agent-run-recommendations "select id, facility_id, posture from recommendations order by id"` (a row with that id and the evaluate step's posture), `RUN_ID=<id> $V db agent-run-decisions "select id, recommendation_id, action from decisions order by id"` (no rows before facility 1's 05:00 local deadline; after it, one `no_decision` row for the narrate step's recommendation, see Gotchas), and `RUN_ID=<id> $V db agent-run-dispatches "select count(*) as dispatches from notification_dispatches"` (`0`).
- **Run after a missed deadline.** Stage Lafayette's (facility `4`) previous recommendation with a `decideBy` in the past through the public route. Run `RUN_ID=<id> $V api agent-run-missed-stage POST /api/facilities/4/recommendations '{"asOf":"2026-01-14T12:00:00Z"}'`. `201` with `"mode":"as_of"` and `"decideBy":"2026-01-14T11:00:00.000Z"`, the facility's 05:00 local deadline on that day. Note its `id`. Then run `RUN_ID=<id> $V agent agent-run-missed-deadline POST /facilities/4/run`. `200 OK`, and `steps[].tool` is exactly `evaluate`, `preview_notifications`, `narrate`. Then run `RUN_ID=<id> $V db agent-run-missed-decision "select d.recommendation_id, d.action, d.decided_by_id, d.decided_by_name from decisions d join recommendations r on r.id = d.recommendation_id where r.facility_id = 4"`. Exactly one row: the staged id, `no_decision`, `3`, `Priya Raman`. Then run `RUN_ID=<id> $V db agent-run-missed-dispatches "select count(*) as dispatches from notification_dispatches"` (`0`).
- **Run unknown facility.** Run `RUN_ID=<id> $V agent agent-run-not-found POST /facilities/999999/run`. Status `404 Not Found`; body is exactly `{"message":"Facility not found"}`.
- **Run malformed id.** Run `RUN_ID=<id> $V agent agent-run-malformed-id POST /facilities/0x1/run`. Status `422 Unprocessable Entity`.
- **Storage failure.** This needs its own instance. Run `STORAGE=broken RUN_ID=<id> $V up`, then `RUN_ID=<id> $V api agent-broken-tasks GET /api/tasks` (`500`), `RUN_ID=<id> $V agent agent-health-broken-storage GET /health` (`200`, `{"status":"ok"}`), and `RUN_ID=<id> $V agent agent-summary-broken-storage GET /tasks/summary` (`500`, `{"message":"Internal server error"}`). `dev.log` shows the agent API's `ApiError`. `down` this instance afterwards.

## Gotchas

- Narrate and run create their recommendation with a live NWS and Open-Meteo pull, so they need network access. If `POST /api/facilities/1/recommendations` fails, the narrate step cannot run and the run returns `500`; report both as unreached.
- `up` exports `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` empty, overriding a developer's `.env`, so `narrated` always equals `template`, in narrate and in the run's narrate step, and `run.env` shows `LLM=template`. This harness does not verify live model narration.
- The API records a `no_decision` row whenever it evaluates a facility whose previous recommendation passed its `decideBy` undecided. A live recommendation's `decideBy` is the facility's 05:00 local deadline on the facility's day, so between that deadline and closing time the Run step's evaluate records one for the Narrate step's recommendation. That row is the API's missed-deadline policy, not an agent decision. The missed-deadline step uses a past `asOf` so it does not depend on the clock.
- The narrate and run steps each create a recommendation row. `down` and `up` before a recipe that expects no recommendations.
- Health proves the process is serving requests. It does not check the tasks API, storage, or any model provider.
- There is no CORS on the agent API. It is called by agents and servers, not by the browser, so do not drive it through `$V browser`.
- The summary depends on the tasks API being up. `up` sets `TASKS_API_URL` from this run's API port, so a `500` from the summary with a healthy `GET /api/tasks` is not a URL typo. Look for the agent API's `ApiError` in `dev.log` after `down`.
- `up` exports `AGENT_API_PORT` and `TASKS_API_URL`, which override a developer's `.env`. Outside `verify.sh`, a missing value, or a `TASKS_API_URL` with a path, query, or credentials, stops the agent API at startup, and `bun run dev` then stops every process.
- The follows-the-API step mutates data. `down` and `up` before running another recipe that expects the baseline.
