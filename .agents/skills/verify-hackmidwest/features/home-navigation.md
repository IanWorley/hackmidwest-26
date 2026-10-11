# Home page

The home page `/` shows each facility's standing under the heading `Facility standing`. A status line counts the facilities whose recommendation nobody has accepted or overridden yet (`Decisions needed: <n>`). The table `Facility standing` has one row per facility: its name as a link to `/facilities/<id>`, its posture label (`Normal operations`, `Delayed arrival`, `Early dismissal`, `Unscheduled telework`, `Full closure`, or `Not evaluated`) with `As of <time> UTC`, when it was evaluated, the time left to decide (`Decide in 2 h 11 min`, `Decision overdue`, or `—` when there is nothing to decide), and `Decision needed`, the decision status (`Accepted`, `Overridden`, `Deferred`, or `Missed decision`), or `—` when not evaluated. A `View conditions` link opens `/conditions`. Every page has a header whose `Hack Midwest` link returns home and whose `Conditions` and `Facilities` links open those pages. No page links to `/tasks`; it is reached by URL.

## Sub-features

- `home-standing` shows the table with every facility `Not evaluated` and `Decisions needed: 0` on a fresh seed.
- `home-decision-needed` counts a facility with a new recommendation and shows its posture, countdown, and `Decision needed`.
- `home-decision-recorded` drops a facility from the count once its recommendation is accepted or overridden, and shows `Accepted` or `Overridden` with no countdown; a deferred or missed decision still counts.
- `home-facility-link` follows a row's facility name client-side to `/facilities/<id>`.
- `home-conditions-link` follows `View conditions` client-side to `/conditions`, and the browser fetches `GET /api/map`.
- `home-header-link` returns to `/` from any page through the header link `Hack Midwest`.
- `home-load-error` shows the alert `Facility standing could not be loaded.` when the map API fails or is unreachable.

## How to get to it (user POV)

- Open the web root `$WEB_URL/`.
- Choose a facility name in the `Facility standing` table.
- Choose `View conditions`.
- Choose `Hack Midwest` in the header from any page.

## Driving it with verify.sh

Preconditions:

- Baseline state from the index (the 4 demo facilities, no recommendations).

- **Open home.** Run `RUN_ID=<id> $V browser goto / expect table "Facility standing" snap home-standing`. `home-standing.aria.yml` has title `Hack Midwest`, navigation `Main` with links `Hack Midwest`, `Conditions`, and `Facilities` (no `Tasks`), heading `Facility standing`, link `View conditions` (`/url: /conditions`), `status: "Decisions needed: 0"`, and rows `Fargo Service Center`, `Kansas City Area Service Center`, `Lafayette Service Center`, `Yakima Service Center` in that order, each reading `Not evaluated — —`.
- **Decision needed.** Create a recommendation, then reload. Run `RUN_ID=<id> $V api home-rec POST /api/facilities/1/recommendations` (`201 Created`), then `RUN_ID=<id> $V browser goto / expect-text "Decisions needed: 1" snap home-decision-needed`. `home-decision-needed.aria.yml` has `status: "Decisions needed: 1"` and row `Kansas City Area Service Center <posture label> As of <date>, <time> UTC Decide in … Decision needed`, where the posture label matches the `posture` in `home-rec.http.txt`. The other rows still read `Not evaluated — —`.
- **Decision recorded.** Accept that recommendation, then reload. Run `RUN_ID=<id> $V api home-decide POST /api/recommendations/<id>/decisions '{"action":"accept","decidedById":1}'` with the `id` from `home-rec.http.txt` (`201 Created`), then `RUN_ID=<id> $V browser goto / expect-text "Decisions needed: 0" snap home-decision-recorded`. The Kansas City row reads `<posture label> As of <date>, <time> UTC — Accepted`.
- **Facility link.** Run `RUN_ID=<id> $V browser goto / click link "Kansas City Area Service Center" expect heading "Kansas City Area Service Center" snap home-to-facility`. Exit code `0`; `home-to-facility.aria.yml` has header `# url: …/facilities/1`, and `browser.log` has `net GET <API_URL>/api/facilities/1 -> 200` after the `step click` line.
- **Conditions link.** Run `RUN_ID=<id> $V browser goto / click link "View conditions" expect toolbar "Map layers" snap home-to-conditions`. Exit code `0`; `home-to-conditions.aria.yml` has header `# url: …/conditions` and title `Conditions · Hack Midwest`, and `browser.log` has `net GET <API_URL>/api/map -> 200` after the `step click` line, which proves the browser (not SSR) loaded the data and CORS allowed it.
- **Header link.** Start on the task list and choose the brand link. Run `RUN_ID=<id> $V browser goto /tasks click link "Hack Midwest" expect table "Facility standing" snap home-from-header`. Exit code `0`; `home-from-header.aria.yml` has header `# url: …/` and title `Hack Midwest`.
- **Client-side load failure.** Hydrate another page, cut the browser off from the API, then go home. Run `RUN_ID=<id> $V browser goto /facilities block-api click link "Hack Midwest" expect-text "Facility standing could not be loaded." snap home-error-client`. The snapshot is at `/`, its main region holds only `- alert: Facility standing could not be loaded.`, and `browser.log` has `net GET <API_URL>/api/map -> FAILED net::ERR_CONNECTION_REFUSED`.
- **Storage failure.** On a `STORAGE=broken` instance, run `RUN_ID=<id> $V browser goto / expect-text "Facility standing could not be loaded." snap home-error`. The snapshot's main region holds only the alert and no table `Facility standing`. `down` this instance before running any baseline recipe.

## Gotchas

- `goto` waits for network idle so the page is hydrated. A click before hydration does a full page load, the data comes from SSR, and no `net GET` line appears. That run proves the link, not client navigation.
- The countdown renders only in the browser and ticks each minute, so `Decide in …` differs between runs. Match its prefix, not its minutes.
- A recommendation's posture comes from live weather, so the label on the Kansas City row varies. Compare it to `home-rec.http.txt`, not to a fixed label.
- `block-api` must come after `goto`. Blocking before the first page loads has no effect on SSR.
- The alert has no accessible name. Use `expect-text`, not `expect alert`.
- CORS allows only `WEB_ORIGIN`. Loading the site through a different host name than `localhost` (for example `127.0.0.1`) makes the client fetch fail and shows the load-failure alert. Always pass paths to `goto`, not absolute URLs.
