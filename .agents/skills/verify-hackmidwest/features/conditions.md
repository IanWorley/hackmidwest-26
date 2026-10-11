# Conditions

The `/conditions` page shows every facility as a pin on a map, colored by its standing and labeled in text with the facility name, the standing (`Normal operations`, `Delayed arrival`, `Early dismissal`, `Unscheduled telework`, `Full closure`, or `Not evaluated`), the time left to decide (`Decide in 2 h 26 min`, `Decision overdue`, or `Decided`), and `As of <time> UTC`, when the standing was evaluated. A facility whose recommendation has a decision shows `Decided` instead of the countdown. An as-of preview never changes a pin. A legend lists the six standings. Three toggle buttons switch the `Alerts` (active NWS alert areas by severity), `Air quality` (an AQI ring around each pin and `AQI 40 · Good` in its label), and `Radar` (NEXRAD tiles) layers on and off. The URL's `?layers=` records the switched-on layers, so a reload or shared link restores them. Each pin opens a popup with a link to its facility page.

## Sub-features

- `conditions-pins` shows one pin per facility with a visible text label, the legend `Posture legend`, and an initial view that fits every facility.
- `conditions-standing` shows the standing, the decide-by countdown or `Decided`, and the evaluation time for a facility with a live recommendation.
- `conditions-layer-url` opens with the layers named in `?layers=` switched on; unknown names are ignored.
- `conditions-toggle` switches a layer when its button is pressed and rewrites `?layers=` in place.
- `conditions-keyboard` reaches and presses the toggles from the keyboard.
- `conditions-alerts` fills active alert areas by severity; hovering one shows its event and onset → end.
- `conditions-aqi` rings each pin in its AQI category color and adds `AQI <value> · <category>` to its label.
- `conditions-radar` overlays NEXRAD radar; if a radar tile fails, the `Radar` toggle disappears for the rest of the visit.
- `conditions-popup` opens a pin's popup with the link `Open <facility name>` to `/facilities/<id>`.
- `conditions-header` reaches the page from the header link `Conditions` on any page.
- `conditions-load-error` shows the alert `Conditions could not be loaded.` when the API fails.

## How to get to it (user POV)

- Open `$WEB_URL/conditions` directly, with or without `?layers=alerts,aqi,radar`.
- Choose `Conditions` in the header navigation from any page.
- Press `Alerts`, `Air quality`, or `Radar` in the `Map layers` toolbar, by mouse or keyboard.
- Choose a facility pin, then `Open <facility name>` in its popup.

## Driving it with verify.sh

Preconditions:

- Baseline state from the index (the 4 demo facilities, no recommendations).
- For `conditions-standing`, create two recommendations and one decision first: `RUN_ID=<id> $V api conditions-rec-kc POST /api/facilities/1/recommendations` and `RUN_ID=<id> $V api conditions-rec-fargo POST /api/facilities/2/recommendations` (both `201`), then `RUN_ID=<id> $V api conditions-decide-fargo POST /api/recommendations/<Fargo's id>/decisions '{"action":"accept","decidedById":5}'` (`201`; person `5` is Fargo's decision maker).

- **Pins, no layers.** Run `RUN_ID=<id> $V browser goto /conditions expect button "Kansas City Area Service Center" snap conditions-pins`. `conditions-pins.aria.yml` has title `Conditions · Hack Midwest`, heading `Conditions`, toolbar `Map layers` with buttons `Alerts`, `Air quality`, `Radar` (none `[pressed]`), list `Posture legend` with the six standings in order, one button per facility, and one tooltip per facility naming it and its standing. The screenshot shows all 4 pins in view.
- **Standing.** After the preconditions' recommendations, the same command's snapshot has tooltip `Kansas City Area Service Center Normal operations Decide in … As of <date>, <time> UTC` (or another posture) and a Fargo tooltip `Fargo Service Center <posture> Decided As of <date>, <time> UTC`. Facilities without a recommendation read `Not evaluated`.
- **Alerts layer.** Run `RUN_ID=<id> $V browser goto "/conditions?layers=alerts" expect button "Kansas City Area Service Center" snap conditions-alerts`. Button `Alerts` is `[pressed]`; the screenshot shows filled alert areas when NWS has active alerts near a facility. Read `RUN_ID=<id> $V api conditions-map GET /api/map` to see whether `alerts.features` is empty.
- **Air quality layer.** Run `RUN_ID=<id> $V browser goto "/conditions?layers=aqi" expect button "Kansas City Area Service Center" snap conditions-aqi`. Button `Air quality` is `[pressed]`, each tooltip with a non-null `aqi` in `/api/map` ends `AQI <value> · <category>`, and the screenshot shows a colored ring around those pins.
- **Radar layer.** Run `RUN_ID=<id> $V browser goto "/conditions?layers=radar" expect button "Kansas City Area Service Center" snap conditions-radar`. Button `Radar` is `[pressed]`; the screenshot shows radar echoes and the attribution `NEXRAD radar: Iowa Environmental Mesonet`.
- **Toggle rewrites the URL.** Run `RUN_ID=<id> $V browser goto /conditions click button "Alerts" snap conditions-toggle`. In `browser.log`, the `at` line after `step click "button" "Alerts"` ends `/conditions?layers=alerts`, and the snapshot has `button "Alerts" [pressed]`.
- **Keyboard.** Run `RUN_ID=<id> $V browser goto /conditions press Tab press Tab press Tab press Tab press Enter press ArrowRight press Space snap conditions-keyboard`. The fourth Tab lands on `Alerts` (after the three header links). In `browser.log`, the `at` line after `step press "Enter"` ends `?layers=alerts` and the one after `step press "Space"` ends `?layers=alerts%2Caqi`; the snapshot has `Alerts` and `Air quality` `[pressed]`.
- **Popup link.** Run `RUN_ID=<id> $V browser goto /conditions click button "Kansas City Area Service Center" expect link "Open Kansas City Area Service Center" snap conditions-popup click link "Open Kansas City Area Service Center" expect heading "Kansas City Area Service Center" snap conditions-to-facility`. `conditions-popup.aria.yml` has the link with `/url: /facilities/1`; `conditions-to-facility.aria.yml` has header `# url: …/facilities/1`, and `browser.log` has `net GET <API_URL>/api/facilities/1 -> 200` after the second click.
- **Header link.** Run `RUN_ID=<id> $V browser goto /facilities click link "Conditions" expect list "Posture legend" snap conditions-header`. Header `# url: …/conditions`, and `browser.log` has `net GET <API_URL>/api/map -> 200` after the click.
- **Load error.** On a `STORAGE=broken` instance, run `RUN_ID=<id> $V browser goto /conditions expect-text "Conditions could not be loaded." snap conditions-error`. The snapshot has the alert and no toolbar `Map layers`.

## Gotchas

- Map and radar tiles come from `basemap.nationalmap.gov` and `mesonet.agron.iastate.edu`, and `/api/map` calls api.weather.gov and Open-Meteo. Without outbound network the base map is blank, and `/api/map` fails, which shows the load-error alert.
- Alerts depend on the live weather. On a calm day `alerts.features` is empty and `conditions-alerts` shows only the pressed button; say so in the proof rather than calling the polygons verified.
- The map renders only in the browser. Its pins and tooltips appear after hydration, so wait for a facility button, never a fixed sleep.
- Toggling a layer does not refetch `/api/map`. Only page loads and client navigation do, so no `net GET` line follows a toggle press.
- The URL encodes the comma in `?layers=` as `%2C`. Both forms open the same layers.
- The radar fallback (toggle hidden after a tile error) has no driver step, since the step language cannot fail a third-party host's tiles.
