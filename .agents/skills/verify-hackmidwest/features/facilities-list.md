# Facility list and detail

The `/facilities` page shows every facility in name order as a row of the `Facilities` table, with its time zone, opening hours, and hazard labels. Each facility name links to a detail page that shows the facility's time zone, hours, NWS zone, and hazards, followed by the decision screen (see [decision-screen](./decision-screen.md)). An id no facility has shows `Facility not found.`. The API serves the same data at `GET /api/facilities` and `GET /api/facilities/:id`.

## Sub-features

- `facilities-ssr` renders the list on a direct page load, with the data fetched by the web server.
- `facilities-row-link` follows a facility name client-side to `/facilities/<id>`, and the browser fetches `GET /api/facilities/<id>`.
- `facilities-detail` shows the facility name as the heading, plus its time zone, hours, NWS zone, and hazards.
- `facilities-not-found` shows `Facility not found.` for an id no facility has, or a path segment that is not a decimal positive integer (`0x1`, `1e0`, `abc`). Malformed ids never reach the API.
- `facilities-list-error` shows the alert `Facilities could not be loaded.` on `/facilities` when the API fails.
- `facilities-load-error` shows `Facility could not be loaded.` with a matching title when the API fails.
- `facilities-api` answers `GET /api/facilities` with every facility in name order, `GET /api/facilities/:id` with one facility, `404 {"message":"Facility not found"}` for an unknown id, and `422` for an id that is not a decimal positive integer (`0x1`, `1e0`, `01`).

## How to get to it (user POV)

- Open `$WEB_URL/facilities` directly (bookmark, reload, or typed URL).
- Choose `Open the facilities` on the home page (see [home-navigation](./home-navigation.md)).
- Choose `Facilities` in the header navigation from any page.
- Choose a facility name in the `Facilities` table.
- Open `$WEB_URL/facilities/<id>` directly.

## Driving it with verify.sh

Preconditions:

- Baseline state from the index (the 4 demo facilities).

- **Direct load.** Open the page by URL. Run `RUN_ID=<id> $V browser goto /facilities expect table "Facilities" snap facilities-list-direct`. `facilities-list-direct.aria.yml` has title `Facilities · Hack Midwest` and table `Facilities` with rows `Fargo Service Center`, `Kansas City Area Service Center`, `Lafayette Service Center`, `Yakima Service Center` in that order. The Kansas City row shows `America/Chicago`, `07:30–16:30`, and list items `Winter storm`, `High wind`, `Air quality`, `Flood`, and its link has `/url: /facilities/1`. `browser.log` has no `net GET` line between this run's `step goto "/facilities"` and `step snap` lines, which proves SSR served the data.
- **Header link.** Choose `Facilities` in the header. Run `RUN_ID=<id> $V browser goto / click link "Facilities" expect table "Facilities" snap facilities-list-header`. Exit code `0`; `facilities-list-header.aria.yml` has header `# url: …/facilities`.
- **Row link.** Choose a facility name. Run `RUN_ID=<id> $V browser goto /facilities click link "Kansas City Area Service Center" expect heading "Kansas City Area Service Center" snap facilities-detail`. `facilities-detail.aria.yml` has header `# url: …/facilities/1`, title `Kansas City Area Service Center · Hack Midwest`, and terms `Time zone`, `Hours`, `NWS zone`, `Hazards` with definitions `America/Chicago`, `07:30–16:30`, `MOZ037`, and list items `Winter storm`, `High wind`, `Air quality`, `Flood`. `browser.log` has `net GET <API_URL>/api/facilities/1 -> 200` after the `step click` line, followed by the decision screen's reads of `…/recommendations/latest`, `…/decisions`, `…/recorders`, and `…/buildings`.
- **Direct detail load.** Open a facility by URL. Run `RUN_ID=<id> $V browser goto /facilities/1 expect heading "Kansas City Area Service Center" snap facilities-detail-direct`. The snapshot matches `facilities-detail`, and `browser.log` has no `net GET` line between this run's `step goto "/facilities/1"` and `step snap` lines, which proves SSR served it.
- **Unknown id.** Open an id no facility has. Run `RUN_ID=<id> $V browser goto /facilities/999 expect-text "Facility not found." snap facilities-not-found`. The snapshot has title `Facility not found · Hack Midwest` and no table or heading.
- **Malformed id.** Open an id that `Number` would read as 1. Run `RUN_ID=<id> $V browser goto /facilities/0x1 expect-text "Facility not found." snap facilities-malformed-id`. The snapshot has title `Facility not found · Hack Midwest` and no heading `Kansas City Area Service Center`.
- **List load error.** On a `STORAGE=broken` instance, run `RUN_ID=<id> $V browser goto /facilities expect-text "Facilities could not be loaded." snap facilities-list-error`. The snapshot has the alert and no table `Facilities`.
- **Load error.** On a `STORAGE=broken` instance, run `RUN_ID=<id> $V browser goto /facilities/1 expect-text "Facility could not be loaded." snap facilities-detail-error`. The snapshot has title `Facility could not be loaded · Hack Midwest`, not the not-found title.
- **API list.** Run `RUN_ID=<id> $V api facilities-api-list GET /api/facilities`. `200` with 4 objects in name order; the Kansas City object has `"hazards":["winter","wind","airQuality","flood"]` and `"nwpsGaugeId":"KCDM7"`; the others have `"nwpsGaugeId":null`.
- **API detail.** Run `RUN_ID=<id> $V api facilities-api-detail GET /api/facilities/1`. `200` with `"name":"Kansas City Area Service Center"` and `"nwsZone":"MOZ037"`.
- **API not found.** Run `RUN_ID=<id> $V api facilities-api-404 GET /api/facilities/999`. `404` with body `{"message":"Facility not found"}`.
- **API large id.** Run `RUN_ID=<id> $V api facilities-api-large-id GET /api/facilities/1000000000000000`. `404` with body `{"message":"Facility not found"}`, not `422`.
- **API malformed id.** Run `RUN_ID=<id> $V api facilities-api-malformed GET /api/facilities/0x1`. `422`, not facility 1.
- **Stored state.** Run `RUN_ID=<id> $V db facilities-rows "select f.id, f.name, group_concat(h.hazard) from facilities f left join facility_hazards h on h.facility_id = f.id group by f.id order by f.name"`. Rows match the rendered names in order, and each row holds the same hazards as the page, in storage order rather than display order.

## Gotchas

- No user path creates or edits a facility. The seed is the only source, so a fresh `up` always shows the same 4 rows.
- `Loading facilities...` and `Loading facility...` are pending views. Wait for table `Facilities` or the heading, never a fixed sleep.
- The not-found page answers with HTTP `404`, so `browser.log` records a `console.error Failed to load resource … 404` line for it. That line is expected, not a failure.
- Hazards render in a fixed order (winter, wind, air quality, flood), not the order they were stored in.
