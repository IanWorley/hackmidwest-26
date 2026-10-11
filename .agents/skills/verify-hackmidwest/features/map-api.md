# Map API

`GET /api/map` returns everything the map draws in one response. `facilities` lists every facility by name with its coordinates, its live Open-Meteo US AQI, and its standing: the current live recommendation (the latest evaluation time, as `findLatestRecommendation` picks it)'s posture, `decideBy`, `asOf` (when it was evaluated), and the newest decision on it (`action`, `chosenPosture`, `decidedAt`, or `null`), or `{"posture":"not_evaluated"}` before any evaluation. `alerts` is a GeoJSON `FeatureCollection` of the active, actual (not test or exercise) NWS alerts at any facility, each listed once and without alerts a later Update or Cancel superseded, with storm-based polygons as NWS drew them and zone-based alerts drawn from their zones' outlines. Standings are read fresh on every request; alerts and AQI are reused for 60 seconds. If NWS or Open-Meteo cannot be reached, `alerts` is `null` and every `aqi` is `null`, and the standings still load.

## Sub-features

- `map-api-not-evaluated` reports `{"posture":"not_evaluated"}` for every facility on a fresh seed.
- `map-api-facilities` lists the 4 demo facilities ordered by name, each with `id`, `name`, `lat`, `lon`, and `aqi` that is `{"value","observedAt"}` or `null`.
- `map-api-standing` reports a facility's current live recommendation as `posture`, `recommendationId`, `decideBy`, `asOf`, and `decision` (`null` until someone decides), on the first load after the recommendation is stored.
- `map-api-preview-ignored` keeps the standing on the live recommendation after a newer as-of preview, since a preview is never a facility's current recommendation.
- `map-api-decided` reports the newest decision on the recommendation as `{"action","chosenPosture","decidedAt"}` once one is recorded.
- `map-api-alerts` returns `alerts` as `{"type":"FeatureCollection","features":[…]}`; each feature has `"type":"Feature"`, the NWS alert `id`, a `Polygon` or `MultiPolygon` `geometry` (or `null` when NWS has no outline), and `properties` `event`, `headline`, `severity`, `certainty`, `urgency`, `onset`, `ends`.
- `map-api-alerts-unique` lists an alert that touches several facilities once.
- `map-api-live-cache` serves a repeat load within 60 seconds without pulling NWS and Open-Meteo again.

## How to get to it (user POV)

- Send `GET /api/map` to `$API_URL`. The web map page will load it.

## Driving it with verify.sh

Preconditions:

- Baseline state from the index: the 4 demo facilities and no recommendations.
- The machine can reach `https://api.weather.gov` and `https://air-quality-api.open-meteo.com`.

- **Fresh seed.** Run `RUN_ID=<id> $V api map-api-fresh GET /api/map`. `200 OK`; `facilities` has 4 entries in the order `Fargo Service Center` (id `2`), `Kansas City Area Service Center` (id `1`), `Lafayette Service Center` (id `4`), `Yakima Service Center` (id `3`); each `standing` is exactly `{"posture":"not_evaluated"}`; each `aqi` is `null` or an object with a numeric `value` and an ISO `observedAt`. `alerts.type` is `FeatureCollection`, and no two features share an `id` (`jq '[.alerts.features[].id] | length == (unique | length)'` prints `true`).
- **Evaluate one facility.** Run `RUN_ID=<id> $V api map-api-evaluate POST /api/facilities/1/recommendations`. `201`; note its `id`, `posture`, `decideBy`, and `asOf`.
- **Evaluated standing.** Run `RUN_ID=<id> $V api map-api-evaluated GET /api/map`. `200`; the Kansas City entry's `standing` is `{"posture":<posture>,"recommendationId":<id>,"decideBy":<decideBy>,"asOf":<asOf>,"decision":null}` with the values from the `POST`, and the other three are still `{"posture":"not_evaluated"}`. Run it within 60 seconds of the fresh-seed load: the standing changes even while live conditions are cached.
- **Preview ignored.** Run `RUN_ID=<id> $V api map-api-preview POST /api/facilities/1/recommendations '{"asOf":"<an ISO instant later today>"}'` (`201`, a higher `id`), then `RUN_ID=<id> $V api map-api-after-preview GET /api/map`. The Kansas City `standing` is unchanged and still names the live recommendation's `id`.
- **Stored state.** Run `RUN_ID=<id> $V db map-api-rows "select r.id, r.facility_id, r.posture, r.decide_by, r.as_of, r.evaluated_at, (select count(*) from decisions d where d.recommendation_id = r.id) as decisions from recommendations r where r.facility_id = 1 order by r.id"`. One row whose `id`, `posture`, `decide_by`, and `as_of` equal the Kansas City standing, `as_of` equals `evaluated_at` (so it is live), and `decisions` is `0` (so `decision` is `null`).
- **Decision recorded.** Run `RUN_ID=<id> $V api map-api-decide POST /api/recommendations/<id>/decisions '{"action":"accept","decidedById":1}'` with the recommendation id from the `POST`, then `RUN_ID=<id> $V api map-api-decided GET /api/map`. `201`, then `200` with the Kansas City `standing` unchanged except `"decision":{"action":"accept","chosenPosture":<posture>,"decidedAt":<decidedAt>}` from the decision response.
- **Cached live conditions.** Wait for the 60 seconds to pass since the last map load, then run `time RUN_ID=<id> $V api map-api-cold GET /api/map` and, within 60 seconds, `time RUN_ID=<id> $V api map-api-warm GET /api/map`. Both `200`, and `alerts` and every `aqi` are identical between the two bodies. The dev log does not record outbound requests, so the proof is timing: the cold load waits on NWS and Open-Meteo (typically a second or more), and the warm one answers in tens of milliseconds.

## Gotchas

- The data is live. Alerts and AQI change between runs, and on a calm day `alerts.features` is `[]`, so `map-api-alerts` and `map-api-alerts-unique` can only be shown on a day with an active alert at a facility. Report them as unverified rather than passing on an empty list.
- Open-Meteo has no AQI for some points, so `aqi` can be `null` for a facility. That is not a failure.
- Each cold load makes one NWS alerts request per facility, one zone request per zone of each zone-based alert, and one Open-Meteo request per facility. NWS rate-limits with `403` and the client retries, so a slow cold `200` is normal. An upstream that stays down after retries gives `200` with `alerts: null` and null AQI for 15 seconds, then the next load tries again; `dev.log` shows `Live conditions unavailable`.
- A failed pull is not cached, so the next load retries it immediately.
- `POST` stores a new row each call. Start from a fresh `up` so the single-row expectation holds.
