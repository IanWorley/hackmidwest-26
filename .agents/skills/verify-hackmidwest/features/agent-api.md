# Agent API

The agent API is a separate backend for agent and AI callers. It runs as its own process on its own port, next to the tasks API. It answers `GET /health` while it is serving requests, and `GET /tasks/summary` with task counts it reads from the tasks API over HTTP. It never opens the database.

## Sub-features

- `agent-health-ok` returns `200` with body exactly `{"status":"ok"}`.
- `agent-health-separate` is served on `AGENT_API_URL`, not on the tasks API's port.
- `agent-health-storage-independent` still returns `200` when the tasks API's storage is failing.
- `agent-summary-ok` returns `200` with `{total, completed, open}` matching the tasks API's list.
- `agent-summary-follows-api` reflects a task created through `POST /api/tasks` on the next request.
- `agent-summary-api-failure` returns `500` with body exactly `{"message":"Internal server error"}` when the tasks API fails.

## How to get to it (user POV)

- Send `GET /health` to `$AGENT_API_URL`.
- Send `GET /tasks/summary` to `$AGENT_API_URL`.

## Driving it with verify.sh

Preconditions:

- Baseline state from the index (seed task only).

- **Health.** Ask the agent API whether it is up. Run `RUN_ID=<id> $V agent agent-health-ok GET /health`. Status `200 OK`; body is exactly `{"status":"ok"}`.
- **Separate process.** Ask the tasks API for the same path. Run `RUN_ID=<id> $V api agent-health-not-on-api GET /health`. Status `404 Not Found`, which proves the route lives only on the agent API's port.
- **Summary.** Read the summary. Run `RUN_ID=<id> $V agent agent-summary-ok GET /tasks/summary`. Status `200 OK`; body is exactly `{"total":1,"completed":0,"open":1}`.
- **Follows the API.** Create a task, then read the summary again. Run `RUN_ID=<id> $V api agent-summary-create POST /api/tasks '{"title":"Ask the agent"}'` (`201`), then `RUN_ID=<id> $V agent agent-summary-after-create GET /tasks/summary`. Body is exactly `{"total":2,"completed":0,"open":2}`. Run `RUN_ID=<id> $V db agent-summary-rows "select id, title, completed from tasks order by id"` to show the two rows the counts came from.
- **Storage failure.** This needs its own instance. Run `STORAGE=broken RUN_ID=<id> $V up`, then `RUN_ID=<id> $V api agent-broken-tasks GET /api/tasks` (`500`), `RUN_ID=<id> $V agent agent-health-broken-storage GET /health` (`200`, `{"status":"ok"}`), and `RUN_ID=<id> $V agent agent-summary-broken-storage GET /tasks/summary` (`500`, `{"message":"Internal server error"}`). `dev.log` shows the agent API's `TasksApiError`. `down` this instance afterwards.

## Gotchas

- Health proves the process is serving requests. It does not check the tasks API, storage, or any model provider.
- There is no CORS on the agent API. It is called by agents and servers, not by the browser, so do not drive it through `$V browser`.
- The summary depends on the tasks API being up. A `500` from the summary with a healthy `GET /api/tasks` means the agent API's `TASKS_API_URL` is wrong.
- `bun run dev` stops every process when one exits. A missing `AGENT_API_PORT` or `TASKS_API_URL` (for example an old `.env`) stops the whole instance during `up`.
- The follows-the-API step mutates data. `down` and `up` before running another recipe that expects the baseline.
