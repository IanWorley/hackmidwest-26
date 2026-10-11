# NWS live pull

`GET /api/nws/live?lat=&lon=` returns a live National Weather Service pull for one point: active alerts with their hazard window, the 12-hour and hourly forecasts, and the nearest station's latest observation normalized into readings. It is a temporary route that shows the NWS client working end to end until the closure evaluate route replaces it.

## Sub-features

- `nws-live-ok` returns `200` with `point`, `alerts`, `forecast`, `hourlyForecast`, and `readings` for a US point.
- `nws-live-readings` lists each non-null observation value as a reading with `source` `nws`, a unit of `degC`, `km/h`, or `m`, and a `rawRef` URL under `https://api.weather.gov/stations/`.
- `nws-live-alert-window` gives each alert a `hazardWindow` whose `endBasis` is `ends`, or `expires` when NWS gave no end time.
- `nws-live-out-of-range` returns `422` for a latitude outside -90..90 or a longitude outside -180..180.
- `nws-live-outside-coverage` returns `500` with body exactly `{"message":"Internal server error"}` for a point NWS does not cover.
- `nws-live-no-storage` leaves the database unchanged; a live pull stores nothing.

## How to get to it (user POV)

- Send `GET /api/nws/live?lat=<latitude>&lon=<longitude>` to `$API_URL`.

## Driving it with verify.sh

Preconditions:

- Baseline state from the index. The route reads no tasks, so any healthy instance works.
- The machine can reach `https://api.weather.gov`.

- **Live pull.** Ask for Kansas City. Run `RUN_ID=<id> $V api nws-live-ok GET '/api/nws/live?lat=39.0997&lon=-94.5786'`. Status `200 OK`; `point` is exactly `{"lat":39.0997,"lon":-94.5786}`; `forecast` and `hourlyForecast` are non-empty arrays of periods; every `readings` entry has `"source":"nws"`, a `unit` of `degC`, `km/h`, or `m`, and a `rawRef` under `https://api.weather.gov/stations/`. `alerts` is often `[]`; when it is not, each alert has a `hazardWindow` with `start`, `end`, and `endBasis`.
- **Out of range.** Ask for a latitude past the pole. Run `RUN_ID=<id> $V api nws-live-out-of-range GET '/api/nws/live?lat=91&lon=-94.5786'`. Status `422 Unprocessable Entity`. A longitude past the antimeridian is the same: `RUN_ID=<id> $V api nws-live-lon-out-of-range GET '/api/nws/live?lat=39.0997&lon=181'` is `422`.
- **Outside coverage.** Ask for London. Run `RUN_ID=<id> $V api nws-live-outside-coverage GET '/api/nws/live?lat=51.5&lon=-0.12'`. Status `500`; body is exactly `{"message":"Internal server error"}`. After `down`, `dev.log` shows an `NWS request failed` line for `51.5,-0.12`. The pulls run in parallel, so it is either the `/points` 404 or the `/alerts/active` 400, whichever fails first.
- **Storage untouched.** After the pulls, read the tasks table. Run `RUN_ID=<id> $V db nws-live-no-storage "select id, title, completed from tasks order by id"`. Exactly one row: `1`, `Build the Hack Midwest demo`, `0`.

## Gotchas

- The data is live. Alerts, forecasts, and readings change between runs, so assert shapes and units, never values.
- api.weather.gov rate-limits by User-Agent with a `403` (or `429`) and sometimes answers `5xx`. The client retries those, and network errors and timeouts too, up to 3 retries after the first attempt with 1, 2, and 4 s backoff and a 10 s timeout per attempt. The observation path chains three requests, so a slow `200` can take well over 7 s and is normal; a `500` for a US point after retries means NWS stayed down, not that the route broke. Rerun before reporting a failure.
- NWS covers US states and territories only. Any other point is the outside-coverage `500`, not a bug.
- `up` sets `NWS_USER_AGENT` to the verify contact string. Outside `verify.sh`, an `.env` without it stops the API during `bun run dev`.
- A station sometimes reports a null value or an unfamiliar unit. That reading is left out, so `readings` can hold fewer than four entries or none.
