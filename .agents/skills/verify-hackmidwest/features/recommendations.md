# Recommendations

`POST /api/facilities/:id/recommendations` pulls live NWS alerts, the hourly forecast, and the nearest station's observation for the facility, plus Open-Meteo's modeled AQI and the facility's NWPS river gauge when it has one. It runs the posture engine once and stores the result as an add-only `recommendations` row. The row holds everything the engine read and returned (`snapshot.input` and `snapshot.output`) and a SHA-256 `contentHash` over every other column. The record can be read back as the facility's latest or by id, and it can be replayed. Replay re-runs the engine on the stored input and says whether it reproduces the stored output. A request body `{"asOf": "<ISO timestamp>"}` evaluates the same freshly pulled data as of that instant, and the response labels it `"mode":"as_of"` so nobody mistakes it for a live call. When the facility's previous recommendation passed its `decideBy` with no decision, the evaluation first records a `no_decision` decision that names the facility's backup decision maker.

## Sub-features

- `recommendations-evaluate-live` returns `201` with `"mode":"live"` and `asOf` equal to `evaluatedAt`. `posture`, `confidence`, and `decideBy` equal `snapshot.output.status.posture`, `snapshot.output.confidence.level`, and `snapshot.output.decideBy.at`. `contentHash` is 64 lowercase hex characters.
- `recommendations-evaluate-as-of` returns `201` with `"mode":"as_of"`, `asOf` set to the requested instant in `toISOString` form, `snapshot.input.now` equal to `asOf`, and an `asOf` entry in `timeline`.
- `recommendations-evaluate-future-as-of` accepts an `asOf` after the clock reading and labels it `"mode":"as_of"`, so the demo can preview a later call.
- `recommendations-forecast-issued-at` stamps `snapshot.input.forecast.asOf` with the forecast's NWS update time, not the fetch time, and `rawRef` with the forecast URL.
- `recommendations-hash-recomputes` lets any client recompute `contentHash` from a response or a stored row. It is the SHA-256 of the canonical JSON (keys sorted at every depth, no whitespace) of `facilityId`, `evaluatedAt`, `asOf`, `posture`, `confidence`, `decideBy`, and `snapshot`.
- `recommendations-timeline` lists `evaluated`, `decideBy`, an `input` entry per input timestamp (`alerts`, `observations`, `forecast`, `airQuality`, `gauge`), and `hazardStart`, `hazardEnd`, and `roadsClear` when a hazard drove the posture, sorted by time.
- `recommendations-invalid-as-of` returns `422` for an `asOf` that is not a timestamp.
- `recommendations-unknown-facility` returns `404 {"message":"Facility not found"}` and stores nothing.
- `recommendations-latest` returns the facility's newest record, and `404 {"message":"Recommendation not found"}` for a facility never evaluated.
- `recommendations-by-id` returns the same body the `POST` returned, and `404 {"message":"Recommendation not found"}` for an unknown id.
- `recommendations-replay` returns `200` with `id`, `stored`, `replayed`, and `"matches":true`, and `404 {"message":"Recommendation not found"}` for an unknown id.
- `recommendations-malformed-id` returns `422` on every recommendation route for an id that is not a decimal positive integer, such as `0x1`.
- `recommendations-stored-row` stores one row per `POST` whose columns match the response.
- `recommendations-add-only` rejects an `UPDATE` of a stored row.
- `recommendations-decide-and-verify` lets the facility's decision maker accept the latest evaluated recommendation, and `GET /api/decisions/:id/verify` then reports the chain intact.
- `recommendations-missed-deadline` records one `no_decision` decision, decided by the facility's backup, for a previous recommendation whose `decideBy` passed with no decision. The check uses the clock, not `asOf`.

## How to get to it (user POV)

- Send `POST /api/facilities/<id>/recommendations` to `$API_URL`, with no body or with `{"asOf": "<ISO timestamp>"}`. The decision screen's "Re-evaluate" button will call this.
- Send `GET /api/facilities/<id>/recommendations/latest`.
- Send `GET /api/recommendations/<id>`.
- Send `GET /api/recommendations/<id>/replay`.
- Decide and verify through the [decisions](./decisions.md) routes.

## Driving it with verify.sh

Preconditions:

- Baseline state from the index on a fresh `up`: the 4 demo facilities and no recommendations.
- The machine can reach `https://api.weather.gov`, `https://air-quality-api.open-meteo.com`, and `https://api.water.noaa.gov`.

- **None yet.** Run `RUN_ID=<id> $V api recommendations-latest-none GET /api/facilities/1/recommendations/latest`. `404` with body `{"message":"Recommendation not found"}`.
- **Live evaluation.** Run `RUN_ID=<id> $V api recommendations-evaluate-live POST /api/facilities/1/recommendations`. `201 Created` with `"id":1`, `"facilityId":1`, `"mode":"live"`, and `asOf` equal to `evaluatedAt`. `posture` equals `snapshot.output.status.posture`. `snapshot.input.forecast.rawRef` starts with `https://api.weather.gov/gridpoints/`, and `snapshot.input.forecast.asOf` is earlier than `evaluatedAt`. `snapshot.input.gauge.rawRef` ends with `/gauges/KCDM7`. `timeline` is sorted by `at` and contains `{"event":"evaluated",…}`, `{"event":"decideBy",…}`, and an `input` entry for each of `alerts`, `observations`, `forecast`, `airQuality`, and `gauge`.
- **As-of evaluation.** Pick an instant an hour before now, for example `date -u -d '-1 hour' +%Y-%m-%dT%H:%M:%SZ`. Run `RUN_ID=<id> $V api recommendations-evaluate-as-of POST /api/facilities/1/recommendations '{"asOf":"<instant>"}'`. `201` with `"id":2` and `"mode":"as_of"`. `asOf` is the instant with `.000Z`, `evaluatedAt` is the clock reading, and `timeline` contains `{"event":"asOf","at":"<asOf>"}`.
- **Future asOf.** Pick an instant an hour after now, for example `date -u -d '+1 hour' +%Y-%m-%dT%H:%M:%SZ`. Run `RUN_ID=<id> $V api recommendations-evaluate-future-as-of POST /api/facilities/1/recommendations '{"asOf":"<instant>"}'`. `201` with `"id":3` and `"mode":"as_of"`. `asOf` is the instant with `.000Z`, later than `evaluatedAt`, and `snapshot.input.now` equals `asOf`.
- **Hash recomputes from responses.** For each of the three `POST` transcripts, compare `jq -r .contentHash` with `jq -cS '{facilityId,evaluatedAt,asOf,posture,confidence,decideBy,snapshot}' | tr -d '\n' | sha256sum` over the response body. They are equal, so nothing the hash covers is missing from the response.
- **Invalid asOf.** Run `RUN_ID=<id> $V api recommendations-invalid-as-of POST /api/facilities/1/recommendations '{"asOf":"tomorrow morning"}'`. `422`.
- **Unknown facility.** Run `RUN_ID=<id> $V api recommendations-unknown-facility POST /api/facilities/999/recommendations`. `404` with body `{"message":"Facility not found"}`.
- **Latest.** Run `RUN_ID=<id> $V api recommendations-latest GET /api/facilities/1/recommendations/latest`. `200` with `"id":3` and `"mode":"as_of"`.
- **Latest for another facility.** Run `RUN_ID=<id> $V api recommendations-latest-other GET /api/facilities/4/recommendations/latest`. `404` with body `{"message":"Recommendation not found"}`.
- **By id.** Run `RUN_ID=<id> $V api recommendations-by-id GET /api/recommendations/1`. `200`, and the body is the live evaluation's body.
- **Unknown id.** Run `RUN_ID=<id> $V api recommendations-by-id-unknown GET /api/recommendations/999`. `404` with body `{"message":"Recommendation not found"}`.
- **Replay.** Run `RUN_ID=<id> $V api recommendations-replay GET /api/recommendations/1/replay`. `200` with `"id":1` and `"matches":true`. `stored` equals the live evaluation's `snapshot.output`, and `replayed` equals `stored`.
- **Replay unknown id.** Run `RUN_ID=<id> $V api recommendations-replay-unknown GET /api/recommendations/999/replay`. `404` with body `{"message":"Recommendation not found"}`.
- **Malformed id.** Run `RUN_ID=<id> $V api recommendations-malformed-evaluate POST /api/facilities/0x1/recommendations`. Then `GET` `/api/facilities/0x1/recommendations/latest`, `/api/recommendations/0x1`, and `/api/recommendations/0x1/replay` as `recommendations-malformed-latest`, `recommendations-malformed-by-id`, and `recommendations-malformed-replay`. Each is `422`, and no row is added.
- **Stored rows.** Run `RUN_ID=<id> $V db recommendations-stored-rows "select id, facility_id, evaluated_at, as_of, posture, confidence, decide_by, content_hash, json_extract(snapshot, '$.input.now') as input_now from recommendations order by id"`. Exactly three rows, ids `1` to `3`, all for facility `1`. Each row's columns equal its `POST` response, and `input_now` equals `as_of`.
- **Hash recomputes from the stored row.** Run `RUN_ID=<id> $V db recommendations-row-preimage "select json_object('asOf', as_of, 'confidence', confidence, 'decideBy', decide_by, 'evaluatedAt', evaluated_at, 'facilityId', facility_id, 'posture', posture, 'snapshot', json(snapshot)) as preimage, content_hash from recommendations where id = 1"`. Pipe the `preimage` column through `jq -cS . | tr -d '\n' | sha256sum`. The digest equals `content_hash`.
- **Add-only.** Run `RUN_ID=<id> $V db-reject recommendations-update "update recommendations set posture = 'normal' where id = 1" "recommendations is add-only: record a newer recommendation instead of updating one"`. `verdict> rejected`.
- **Decide and verify.** Run `RUN_ID=<id> $V api recommendations-accept-latest POST /api/recommendations/3/decisions '{"action":"accept","decidedById":1}'`. `201` with `"id":1`, `"recommendationId":3`, and `chosenPosture` equal to recommendation 3's `posture`. Then run `RUN_ID=<id> $V api recommendations-accept-verify GET /api/decisions/1/verify`. `200` with `{"decisionId":1,"intact":true,"breaks":[]}`.
- **Missed deadline.** The live clock passes a facility's `decideBy` only once a day, so stage Lafayette's (facility `4`) previous recommendation, with a `decideBy` in the past, using `sqlite3` against the instance's `DB_PATH`. This is the recipe's only direct write. Its hash is the canonical-JSON digest, so the chain still verifies:

  ```sh
  source /tmp/verify-hackmidwest/runs/<id>/state.env
  PAST='{"asOf":"2026-01-14T09:00:00.000Z","confidence":"medium","decideBy":"2026-01-14T10:00:00.000Z","evaluatedAt":"2026-01-14T09:00:00.000Z","facilityId":4,"posture":"delayed_arrival","snapshot":{}}'
  sqlite3 "$DB_PATH" "insert into recommendations (facility_id, evaluated_at, as_of, posture, confidence, decide_by, snapshot, content_hash) values (4, '2026-01-14T09:00:00.000Z', '2026-01-14T09:00:00.000Z', 'delayed_arrival', 'medium', '2026-01-14T10:00:00.000Z', '{}', '$(printf '%s' "$PAST" | sha256sum | cut -c1-64)')"
  ```

  Run `RUN_ID=<id> $V api recommendations-missed-evaluate POST /api/facilities/4/recommendations`. `201` with `"id":5`. Then run `RUN_ID=<id> $V db recommendations-missed-decision "select d.id, d.recommendation_id, d.action, d.decided_by_id, d.decided_by_name, d.recommendation_hash = r.content_hash as hash_matches from decisions d join recommendations r on r.id = d.recommendation_id order by d.id"`. Two rows: `1|3|accept|1|Dana Whitfield|1` and `2|4|no_decision|3|Priya Raman|1`. Then run `RUN_ID=<id> $V api recommendations-missed-history GET /api/facilities/4/decisions` and `RUN_ID=<id> $V api recommendations-missed-verify GET /api/decisions/2/verify`. The history lists decision `2` with `"action":"no_decision"` and `"decidedByName":"Priya Raman"`, and verify answers `{"decisionId":2,"intact":true,"breaks":[]}`.
- **Missed deadline is recorded once.** Run `RUN_ID=<id> $V api recommendations-missed-again POST /api/facilities/4/recommendations`, then `RUN_ID=<id> $V db recommendations-missed-once "select count(*) as no_decisions from decisions where action = 'no_decision'"`. `1`. The previous recommendation is now `5`, whose `decideBy` has not passed.

## Gotchas

- The data is live. Posture, confidence, readings, and alerts change between runs, so assert shapes, ids, modes, and equalities between responses, never weather values.
- Each `POST` makes several upstream requests in parallel (alerts, points, hourly forecast, stations, latest observation, Open-Meteo, and the NWPS gauge and its forecast). NWS rate-limits with `403`, and the client retries, so a slow `201` is normal. A `500` after retries means an upstream stayed down. Rerun before you report a failure, and check `dev.log` for `NWS request failed`, `NWPS request failed`, or `OpenMeteoError`.
- `POST` is not idempotent. Each call stores a new row with the next id, so start from a fresh `up` to keep the ids in this recipe.
- The missed-deadline check runs on the facility's previous recommendation and uses the clock. An `asOf` past `decideBy` does not trigger it. If the run happens after a facility's 05:00 local deadline, a second live `POST` for that facility also writes a `no_decision` row, which shifts the decision ids above.
- Replay returns `"matches":false` only if the engine changed since the row was stored, or the row was written outside the API. Neither happens on a fresh instance.
