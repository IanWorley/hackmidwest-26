# Map API

`GET /api/map` returns everything the map draws in one response. `facilities` lists every facility by name with its coordinates, its live Open-Meteo US AQI, and its standing: the current live recommendation (the latest evaluation time, as `findLatestRecommendation` picks it)'s posture, `decideBy`, `asOf` (when it was evaluated), and `currentDecision`, the facility's current decision as `findCurrentDecision` defines it (the newest decision on a live recommendation for today's facility day: `recommendationId`, `action`, `chosenPosture`, `decidedAt`, and `recheckAt` for a deferral, or `null`), or `{"posture":"not_evaluated"}` before any evaluation. `alerts` is a GeoJSON `FeatureCollection` of the active, actual (not test or exercise) NWS alerts at any facility, each listed once and without alerts a later Update or Cancel superseded, with storm-based polygons as NWS drew them and zone-based alerts drawn from their zones' outlines. Standings are read fresh on every request; alerts and AQI are reused for 60 seconds. If NWS or Open-Meteo cannot be reached, `alerts` is `null` and every `aqi` is `null`, and the standings still load.

## Sub-features

- `map-api-not-evaluated` reports `{"posture":"not_evaluated"}` for every facility on a fresh seed.
- `map-api-facilities` lists the 4 demo facilities ordered by name, each with `id`, `name`, `lat`, `lon`, and `aqi` that is `{"value","observedAt"}` or `null`.
- `map-api-standing` reports a facility's current live recommendation as `posture`, `recommendationId`, `decideBy`, `asOf`, and `currentDecision` (`null` until someone decides), on the first load after the recommendation is stored.
- `map-api-preview-ignored` keeps the standing on the live recommendation after a newer as-of preview, since a preview is never a facility's current recommendation.
- `map-api-decided` reports the newest decision as `currentDecision` `{"recommendationId","action","chosenPosture","decidedAt","recheckAt"}` once one is recorded.
- `map-api-re-evaluated` keeps that decision as `currentDecision` after a same-day re-evaluation, while the standing names the new recommendation, so its differing `recommendationId` shows the new recommendation still awaits a decision.
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
- **Evaluated standing.** Run `RUN_ID=<id> $V api map-api-evaluated GET /api/map`. `200`; the Kansas City entry's `standing` is `{"posture":<posture>,"recommendationId":<id>,"decideBy":<decideBy>,"asOf":<asOf>,"currentDecision":null}` with the values from the `POST`, and the other three are still `{"posture":"not_evaluated"}`. Run it within 60 seconds of the fresh-seed load: the standing changes even while live conditions are cached.
- **Preview ignored.** Run `RUN_ID=<id> $V api map-api-preview POST /api/facilities/1/recommendations '{"asOf":"<an ISO instant later today>"}'` (`201`, a higher `id`), then `RUN_ID=<id> $V api map-api-after-preview GET /api/map`. The Kansas City `standing` is unchanged and still names the live recommendation's `id`.
- **Stored state.** Run `RUN_ID=<id> $V db map-api-rows "select r.id, r.facility_id, r.posture, r.decide_by, r.as_of, r.evaluated_at, (select count(*) from decisions d where d.recommendation_id = r.id) as decisions from recommendations r where r.facility_id = 1 order by r.id"`. Two rows. The first is live (`as_of` equals `evaluated_at`) and its `id`, `posture`, `decide_by`, and `as_of` equal the Kansas City standing. The second is the preview (`as_of` differs from `evaluated_at`) that the map ignored. Both have `0` decisions, so `currentDecision` is `null`.
- **Decision recorded.** Run `RUN_ID=<id> $V api map-api-decide POST /api/recommendations/<id>/decisions '{"action":"accept","decidedById":1}'` with the recommendation id from the `POST`, then `RUN_ID=<id> $V api map-api-decided GET /api/map`. `201`, then `200` with the Kansas City `standing` unchanged except `"currentDecision":{"recommendationId":<id>,"action":"accept","chosenPosture":<posture>,"decidedAt":<decidedAt>,"recheckAt":null}` from the decision response.
- **Re-evaluated.** Run `RUN_ID=<id> $V api map-api-re-evaluate POST /api/facilities/1/recommendations` (`201`, a new live `id`), then `RUN_ID=<id> $V api map-api-re-evaluated GET /api/map`. The Kansas City `standing` names the new `recommendationId`, `decideBy`, and `asOf`, and its `currentDecision` is the accept unchanged, still naming the first recommendation's `id`. Read `RUN_ID=<id> $V db map-api-decision-rows "select id, recommendation_id, action, chosen_posture from decisions where facility_id = 1 order by id"`: one row, on the first recommendation.
- **Cached live conditions.** Wait for the 60 seconds to pass since the last map load. Count the pull lines with `grep -c 'Pulling live conditions from NWS and Open-Meteo' /tmp/verify-hackmidwest/runs/<id>/dev.log`, then run `RUN_ID=<id> $V api map-api-cold GET /api/map` and, within 60 seconds, `RUN_ID=<id> $V api map-api-warm GET /api/map`, and count again after each. Both answer `200` with identical `alerts` and `aqi`. The count rises by exactly one after the cold load and not at all after the warm one, so the warm load reused the cached pull.

## Gotchas

- The data is live. Alerts and AQI change between runs, and on a calm day `alerts.features` is `[]`, so `map-api-alerts` and `map-api-alerts-unique` can only be shown on a day with an active alert at a facility. Report them as unverified rather than passing on an empty list.
- Open-Meteo has no AQI for some points, so `aqi` can be `null` for a facility. That is not a failure.
- Each cold load makes one NWS alerts request per facility, one zone request per distinct zone across the zone-based alerts, and one Open-Meteo request per facility. NWS rate-limits with `403` and the client retries, so a slow cold `200` is normal. An upstream that stays down after retries gives `200` with `alerts: null` and null AQI for 15 seconds, then the next load tries again; `dev.log` shows `Live conditions unavailable`.
- `POST` stores a new row each call. Start from a fresh `up` so the stored-state step's two-row expectation holds.
