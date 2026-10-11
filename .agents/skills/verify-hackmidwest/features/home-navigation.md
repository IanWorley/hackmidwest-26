# Home page

The home page shows two links, one to the project task list and one to the facility list. Each opens its page without a full page reload; the browser itself then fetches the data from the API. Every page has a header whose `Hack Midwest` link returns home and whose `Conditions` and `Facilities` links open those pages. The task list is reached from the home page only.

## Sub-features

- `home-link` shows the `Open the project tasks` and `Open the facilities` links on `/`.
- `home-client-nav` follows the tasks link client-side to `/tasks`, and the browser fetches `GET /api/tasks` across origins (CORS).
- `home-facilities-nav` follows the facilities link client-side to `/facilities`, and the browser fetches `GET /api/facilities`.
- `home-header-link` returns to `/` from any page through the header link `Hack Midwest`.

## How to get to it (user POV)

- Open the web root `$WEB_URL/`.
- Choose `Open the project tasks`.
- Choose `Open the facilities`.
- Choose `Hack Midwest` in the header from any page.

## Driving it with verify.sh

Preconditions:

- Baseline state from the index (seed task only).

- **Open home.** Load the root page. Run `RUN_ID=<id> $V browser goto / expect link "Open the project tasks" snap home-before`. `home-before.aria.yml` shows navigation `Main` with links `Hack Midwest`, `Conditions`, and `Facilities` (no `Tasks`), and a main region whose only content is links `Open the project tasks` (`/url: /tasks`) and `Open the facilities` (`/url: /facilities`).
- **Follow the link.** In the same browser session, choose the link and wait for the list. Run `RUN_ID=<id> $V browser goto / click link "Open the project tasks" expect table "Tasks" snap home-after`. Exit code `0`; `home-after.aria.yml` has header `# url: …/tasks` and checkbox `Build the Hack Midwest demo`.
- **Proof of client-side fetch.** Inspect the log. Run `grep -E 'step click|net GET' /tmp/verify-hackmidwest/artifacts/<id>/browser.log`. A `net GET <API_URL>/api/tasks -> 200` line follows the `step click` line, which proves the browser (not SSR) loaded the data and CORS allowed it.
- **Follow the facilities link.** Run `RUN_ID=<id> $V browser goto / click link "Open the facilities" expect table "Facilities" snap home-to-facilities`. Exit code `0`; `home-to-facilities.aria.yml` has header `# url: …/facilities`, and `browser.log` has `net GET <API_URL>/api/facilities -> 200` after the `step click` line.
- **Header link.** Start on the task list and choose the brand link. Run `RUN_ID=<id> $V browser goto /tasks click link "Hack Midwest" expect link "Open the project tasks" snap home-from-header`. Exit code `0`; `home-from-header.aria.yml` has header `# url: …/` and title `Hack Midwest`.

## Gotchas

- `goto` waits for network idle so the page is hydrated. A click before hydration does a full page load, the data comes from SSR, and no `net GET` line appears. That run proves the link, not client navigation.
- A missing `net GET` line after the click with the list still visible means SSR served the page. Treat it as an unproven `home-client-nav`, not a pass.
- CORS allows only `WEB_ORIGIN`. Loading the site through a different host name than `localhost` (for example `127.0.0.1`) makes the client fetch fail (`net GET … -> FAILED net::ERR_FAILED`) and shows the load-failure alert. Always pass paths to `goto`, not absolute URLs.
