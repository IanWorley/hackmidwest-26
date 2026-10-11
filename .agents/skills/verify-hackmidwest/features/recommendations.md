# Recommendations

`POST /api/facilities/:id/recommendations` pulls live NWS alerts, the hourly forecast, the nearest station's observation, and Open-Meteo's modeled AQI for the facility, runs the posture engine once, and stores the result as an add-only `recommendations` row. The row holds everything the engine read and returned (`snapshot.input` and `snapshot.output`) and a SHA-256 `contentHash` over every column. The record can be read back as the facility's latest, by id, and replayed: the replay re-runs the engine on the stored input and says whether it reproduces the stored output. A request body `{"asOf": "<ISO timestamp>"}` evaluates the same freshly pulled data as of that instant, and the response labels it `"mode":"as_of"` so it is not mistaken for a live call.

## Sub-features

- `recommendations-evaluate-live` returns `201` with `"mode":"live"`, `asOf` equal to `evaluatedAt`, `posture`, `confidence`, and `decideBy` copied from `snapshot.output`, and a 64-character lowercase hex `contentHash`.
- `recommendations-evaluate-as-of` returns `201` with `"mode":"as_of"`, `asOf` set to the requested instant in `toISOString` form, `snapshot.input.now` equal to `asOf`, and an `asOf` entry in `timeline`.
- `recommendations-evaluate-future-as-of` accepts an `asOf` after the clock reading and labels it `"mode":"as_of"`, so the demo can preview the next morning's call.
- `recommendations-hash-recomputes` lets any client recompute `contentHash` from a response: SHA-256 of the canonical JSON (keys sorted at every depth, no whitespace) of `facilityId`, `evaluatedAt`, `asOf`, `posture`, `confidence`, `decideBy`, and `snapshot`.
- `recommendations-timeline` lists `evaluated`, `decideBy`, one `input` entry per input the engine cited, and `hazardStart`, `hazardEnd`, `roadsClear` when a hazard drove the posture, sorted by time.
- `recommendations-invalid-as-of` returns `422` for an `asOf` that is not a timestamp.
- `recommendations-unknown-facility` returns `404 {"message":"Facility not found"}` and stores nothing.
- `recommendations-latest` returns the facility's newest record, and `404 {"message":"Recommendation not found"}` for a facility never evaluated.
- `recommendations-by-id` returns the same body the `POST` returned, and `404 {"message":"Recommendation not found"}` for an unknown id.
- `recommendations-replay` returns `200` with `id`, `stored`, `replayed`, and `"matches":true`, and `404 {"message":"Recommendation not found"}` for an unknown id.
- `recommendations-malformed-id` returns `422` on every recommendation route for an id that is not a decimal positive integer, such as `0x1`.
- `recommendations-stored-row` stores one row per `POST` whose columns match the response.
- `recommendations-add-only` rejects an `UPDATE` of a stored row.

## How to get to it (user POV)

- Send `POST /api/facilities/<id>/recommendations` to `$API_URL`, with no body or with `{"asOf": "<ISO timestamp>"}`. The decision screen's "Re-evaluate" button will call this.
- Send `GET /api/facilities/<id>/recommendations/latest`.
- Send `GET /api/recommendations/<id>`.
- Send `GET /api/recommendations/<id>/replay`.

## Driving it with verify.sh

Preconditions:

- Baseline state from the index: the 4 demo facilities and no recommendations.
- The machine can reach `https://api.weather.gov` and `https://air-quality-api.open-meteo.com`.

- **None yet.** Run `RUN_ID=<id> $V api recommendations-latest-none GET /api/facilities/1/recommendations/latest`. `404` with body `{"message":"Recommendation not found"}`.
- **Live evaluation.** Run `RUN_ID=<id> $V api recommendations-evaluate-live POST /api/facilities/1/recommendations`. `201 Created`; `"id":1`, `"facilityId":1`, `"mode":"live"`, `asOf` equal to `evaluatedAt`; `posture` equals `snapshot.output.status.posture`; `snapshot.input.forecast` has a `rawRef` under `https://api.weather.gov/gridpoints/` and an `updateTime`; `timeline` starts and ends with the earliest and latest instants and contains `{"event":"evaluated",…}` and `{"event":"decideBy",…}`.
- **As-of evaluation.** Pick an instant an hour before now, for example `date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%SZ`. Run `RUN_ID=<id> $V api recommendations-evaluate-as-of POST /api/facilities/1/recommendations '{"asOf":"<instant>"}'`. `201`; `"id":2`, `"mode":"as_of"`, `asOf` is the instant with `.000Z`, `evaluatedAt` is the clock reading, and `timeline` contains `{"event":"asOf","at":"<asOf>"}`.
- **Future asOf.** Pick an instant an hour after now, for example `date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ`. Run `RUN_ID=<id> $V api recommendations-evaluate-future-as-of POST /api/facilities/1/recommendations '{"asOf":"<instant>"}'`. `201`; `"id":3`, `"mode":"as_of"`, `asOf` is the instant with `.000Z` and later than `evaluatedAt`, and `snapshot.input.now` equals `asOf`.
- **Hash recomputes.** For each of the three `POST` transcripts, compare `jq -r .contentHash` with `jq -cS '{facilityId,evaluatedAt,asOf,posture,confidence,decideBy,snapshot}' | tr -d '\n' | sha256sum` over the response body. They are equal, so nothing the hash covers is missing from the response.
- **Invalid asOf.** Run `RUN_ID=<id> $V api recommendations-invalid-as-of POST /api/facilities/1/recommendations '{"asOf":"tomorrow morning"}'`. `422`.
- **Unknown facility.** Run `RUN_ID=<id> $V api recommendations-unknown-facility POST /api/facilities/999/recommendations`. `404` with body `{"message":"Facility not found"}`.
- **Latest.** Run `RUN_ID=<id> $V api recommendations-latest GET /api/facilities/1/recommendations/latest`. `200` with `"id":3` and `"mode":"as_of"`.
- **Latest for another facility.** Run `RUN_ID=<id> $V api recommendations-latest-other GET /api/facilities/4/recommendations/latest`. `404` with body `{"message":"Recommendation not found"}`.
- **By id.** Run `RUN_ID=<id> $V api recommendations-by-id GET /api/recommendations/1`. `200`; the body is byte-for-byte the live evaluation's body.
- **Unknown id.** Run `RUN_ID=<id> $V api recommendations-by-id-unknown GET /api/recommendations/999`. `404` with body `{"message":"Recommendation not found"}`.
- **Replay.** Run `RUN_ID=<id> $V api recommendations-replay GET /api/recommendations/1/replay`. `200` with `"id":1` and `"matches":true`; `stored` equals the live evaluation's `snapshot.output` and `replayed` equals `stored`.
- **Replay unknown id.** Run `RUN_ID=<id> $V api recommendations-replay-unknown GET /api/recommendations/999/replay`. `404` with body `{"message":"Recommendation not found"}`.
- **Malformed id.** Run `RUN_ID=<id> $V api recommendations-malformed-evaluate POST /api/facilities/0x1/recommendations`, then `GET` `/api/facilities/0x1/recommendations/latest`, `/api/recommendations/0x1`, and `/api/recommendations/0x1/replay` as `recommendations-malformed-latest`, `recommendations-malformed-by-id`, and `recommendations-malformed-replay`. Each is `422`, and no row is added.
- **Stored rows.** Run `RUN_ID=<id> $V db recommendations-stored-rows "select id, facility_id, evaluated_at, as_of, posture, confidence, decide_by, length(content_hash), json_valid(snapshot), json_extract(snapshot, '$.input.now') from recommendations order by id"`. Exactly three rows, ids `1` to `3`, for facility `1`. Each row's columns equal its `POST` response; `length(content_hash)` is `64`, `json_valid(snapshot)` is `1`, and the snapshot's `input.now` equals `as_of`.
- **Add-only.** Run `RUN_ID=<id> $V db-reject recommendations-update "update recommendations set posture = 'normal' where id = 1" "recommendations is add-only: record a newer recommendation instead of updating one"`. `verdict> rejected`.

## Gotchas

- The data is live. Posture, confidence, readings, and alerts change between runs, so assert shapes, ids, modes, and equalities between responses, never weather values.
- An as-of instant before the data was pulled hides inputs stamped after it: the engine ignores observations and forecasts newer than its `now`. An hour back usually lowers confidence and adds `missingReading` caveats. That is the engine being honest about what it knew, not a bug.
- Each `POST` makes five upstream requests in parallel (alerts, points, hourly forecast, stations, latest observation) plus one to Open-Meteo. NWS rate-limits with `403` and the client retries, so a slow `201` is normal. A `500` after retries means an upstream stayed down; rerun before reporting a failure, and check `dev.log` for `NWS request failed` or `OpenMeteoError`.
- `POST` is not idempotent: each call stores a new row with the next id. Start from a fresh `up` so the ids in this recipe hold.
- Replay can only return `"matches":false` if the engine changed since the row was stored or the row was written outside the API. Neither happens on a fresh instance.
