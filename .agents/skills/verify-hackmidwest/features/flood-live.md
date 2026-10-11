# Flood live pull

`GET /api/flood/live?lat=&lon=&gauge=` returns the live flood signals for one point: active NWS Flood and Flash Flood Warnings, and, when a gauge is given, that river gauge's NWPS flood stages, latest observed stage, and stage forecast. It also reports when the gauge is at or above each flood category and which flood cutoffs are crossed. It is a temporary route that shows the flood signals working end to end until the closure evaluate route replaces it.

## Sub-features

- `flood-live-gauge` returns `200` with `point`, `alerts`, `gauge`, `crossings`, and `crossedCutoffs` for a point and a gauge id.
- `flood-live-no-gauge` returns `200` with `"gauge":null` and `"crossings":{}` when `gauge` is omitted; alerts still apply.
- `flood-live-alert` lists only `Flood Warning` and `Flash Flood Warning` alerts, and a `Severe` one sets `crossedCutoffs.warning` to `true`.
- `flood-live-in-flood` gives each flood category the gauge reaches a `crossings` entry with `start` and `end` (`null` while still above at the forecast horizon), and sets `moderateFlood` or `majorFlood` when the gauge reaches that category.
- `flood-live-bad-gauge` returns `422` for a gauge that is not four capital letters and a digit, and for a latitude or longitude out of range.
- `flood-live-unknown-gauge` returns `500` with body exactly `{"message":"Internal server error"}` for a well-formed gauge id NWPS does not know.
- `flood-live-seed` seeds the Kansas City facility with gauge `KCDM7` and a `flood` hazard; the other facilities have no gauge.

## How to get to it (user POV)

- Send `GET /api/flood/live?lat=<latitude>&lon=<longitude>&gauge=<lid>` to `$API_URL`. `gauge` is optional.

## Driving it with verify.sh

Preconditions:

- Baseline state from the index.
- The machine can reach `https://api.weather.gov` and `https://api.water.noaa.gov`.

- **Gauge pull.** Ask for Kansas City with the Missouri River gauge. Run `RUN_ID=<id> $V api flood-live-gauge GET '/api/flood/live?lat=39.0997&lon=-94.5786&gauge=KCDM7'`. Status `200 OK`; `point` is exactly `{"lat":39.0997,"lon":-94.5786}`; `gauge.lid` is `KCDM7`, `gauge.name` is `Missouri River at Kansas City`, `gauge.floodStagesFt` is `{"action":29,"minor":32,"moderate":35,"major":49}`, `gauge.rawRef` is `https://api.water.noaa.gov/nwps/v1/gauges/KCDM7`, and `gauge.forecast` is a non-empty array of `{stageFt, validTime}`.
- **No gauge.** Ask for the same point without a gauge. Run `RUN_ID=<id> $V api flood-live-no-gauge GET '/api/flood/live?lat=39.0997&lon=-94.5786'`. Status `200 OK`; `gauge` is `null`; `crossings` is `{}`; `crossedCutoffs.moderateFlood` and `crossedCutoffs.majorFlood` are `false`.
- **Active warning.** Find a point under a live warning: open `https://api.weather.gov/alerts/active?event=Flood%20Warning,Flash%20Flood%20Warning` and take a point inside one alert's polygon. Run `RUN_ID=<id> $V api flood-live-alert GET '/api/flood/live?lat=<lat>&lon=<lon>'`. Status `200 OK`; every alert's `event` is `Flood Warning` or `Flash Flood Warning`; when one has `"severity":"Severe"`, `crossedCutoffs.warning` is `true`. If no warning is active anywhere, report this entry point as not reached.
- **Gauge in flood.** Find a gauge at moderate or major flood: open `https://api.water.noaa.gov/nwps/v1/gauges?bbox.xmin=-125&bbox.ymin=24&bbox.xmax=-66&bbox.ymax=50&srid=EPSG_4326` and pick a `lid` whose `status.observed.floodCategory` is `moderate` or `major`. Run `RUN_ID=<id> $V api flood-live-in-flood GET '/api/flood/live?lat=<gauge latitude>&lon=<gauge longitude>&gauge=<lid>'`. Status `200 OK`; `crossings` has an entry for each category the stage reaches; `crossedCutoffs.moderateFlood` is `true` (and `majorFlood` too for a major gauge with a major stage). If no gauge is in flood, report this entry point as not reached.
- **Bad gauge.** Send a lower-case id. Run `RUN_ID=<id> $V api flood-live-bad-gauge GET '/api/flood/live?lat=39.0997&lon=-94.5786&gauge=kcdm7'`. Status `422 Unprocessable Entity`. An out-of-range latitude is the same: `RUN_ID=<id> $V api flood-live-bad-lat GET '/api/flood/live?lat=91&lon=-94.5786'` is `422`.
- **Unknown gauge.** Send a well-formed id that does not exist. Run `RUN_ID=<id> $V api flood-live-unknown-gauge GET '/api/flood/live?lat=39.0997&lon=-94.5786&gauge=ZZZZ9'`. Status `500`; body is exactly `{"message":"Internal server error"}`. After `down`, `dev.log` shows `NwpsError` and `NWPS request failed (HTTP 404)` for a `gauges/ZZZZ9` URL.
- **Seeded gauge.** Read the facility gauges. Run `RUN_ID=<id> $V db flood-live-seed "select id, nwps_gauge_id from facilities order by id"`. Exactly four rows; only id `1` has `KCDM7`. Then run `RUN_ID=<id> $V db flood-live-seed-hazard "select facility_id from facility_hazards where hazard = 'flood'"`. Exactly one row: `1`.

## Gotchas

- The data is live. Stages, forecasts, and alerts change between runs, so assert shapes, units, and gauge ids, never stages. KCDM7's flood stages are the stable exception.
- A gauge with no forecast is normal: `gauge.forecast` is `[]`. A gauge that reports flow instead of stage, or has no observation, has `"observed":null`. Neither is an error. Stages older than 6 hours are dropped too, so a gauge that stopped reporting has `"observed":null` and no crossings even if NWPS still maps it in flood.
- A gauge with no stage for a category never crosses it, so `crossings` can skip categories below one it lists.
- `moderateFlood` and `majorFlood` come from the gauge stage, not from NWPS's own `floodCategory`, so they can disagree with the NWPS map for a moment after a new observation.
- An unknown gauge is the generic `500`, not a `404`; that is by design for this temporary route.
- Both upstreams answer `5xx` now and then. The clients retry, backing off up to about 7 s, so a slow `200` is normal. Rerun before reporting a failure.
