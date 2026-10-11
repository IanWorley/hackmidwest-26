# Decision screen

The facility page at `/facilities/<id>` is where a decision maker makes the closure call. It shows the latest recommendation, the time left until its `decideBy` deadline, the reasoning behind it, and the facility's decision history. `Re-evaluate` pulls live conditions and loads a fresh recommendation. Accept, Override, and Defer each open a form with a `Recorded by` select that offers the facility's decision maker and then its backup, with a note that identity is unverified. Override and Defer require a reason. Once an accept or override is current, a Directives section can tell a building, the essential group, or one employee to do something other than the posture says. When someone else decides or re-evaluates first, the submit is refused, the page reloads, and an alert says why.

## Sub-features

- `screen-recommendation` shows the posture as a labeled badge, `Confidence: <level>`, a `Live evaluation` or `As-of evaluation` label, the rationale, any thresholds crossed, caveats, inputs with their sources, and sensitivity statements. An early dismissal whose release time has passed says `release time has passed`.
- `screen-countdown` shows `Decide by <facility-local time>` and `<h> h <m> min left to decide`, or `Decision deadline passed <…> ago`, as text in a polite live region.
- `screen-reevaluate` posts a fresh recommendation, reloads the page with it, and says `New recommendation loaded.`. With no recommendation yet, the page says `No recommendation yet.` and offers only `Re-evaluate`.
- `screen-accept`, `screen-override`, `screen-defer` record a decision. Override offers every posture but the recommended one. Defer offers re-check times of 15, 30, 60, or 120 min that fall before the deadline.
- `screen-reason-required` flags `Enter a reason.` on the `Reason` field, tied to it with `aria-describedby`, when Override or Defer is submitted without one, and records nothing. A change to a standing decision needs a reason even on Accept.
- `screen-recorded-by` offers exactly the facility's decision maker and backup, and shows `Identity unverified: …` under the select.
- `screen-recorded` shows `Decision recorded.` and the new row at the top of `Decision history`, with `(unverified)` after the recorder.
- `screen-directives` issues a directive for the whole facility, the essential group, a building, or one employee, with a required reason, and lists it under `Directives`.
- `screen-stale` shows `Someone else decided first.` when another decision landed after the page loaded, and `A newer recommendation exists.` when a newer recommendation did. Nothing is saved and the page reloads.
- `screen-backup` shows `Nobody decided before the deadline.` naming the backup decision maker when the newest history row is a missed deadline.
- `screen-api` serves `GET /api/facilities/:id/recorders` (the decision maker, then the backup, as `{id,name,role}`) and `GET /api/facilities/:id/buildings` (each building with its employees' ids and names), each `404` for an unknown facility.

## How to get to it (user POV)

- Choose a facility name in the `Facilities` table (see [facilities-list](./facilities-list.md)).
- Open `$WEB_URL/facilities/<id>` directly.
- Use a second browser tab on the same facility to act as another decision maker.

## Driving it with verify.sh

Preconditions:

- Baseline state from the index, on a fresh `up`. Facility `1` is Kansas City; its recorders are `Dana Whitfield, County Executive Director` and `Marcus Oyelaran, State Administrative Officer`.
- Kansas City's `decideBy` is 05:00 America/Chicago. Run before it passes, or Defer has no re-check time to offer and the countdown reads as passed.
- The browser steps `fill <label> <text>`, `select <label> <option>`, `tab <name>`, and `within <role> <name>` drive forms, a second person's tab, and one form when two share a label.

- **Re-evaluate and countdown.** Run `RUN_ID=<id> $V browser goto /facilities/1 expect-text "No recommendation yet. Re-evaluate to pull live conditions and get one." click button "Re-evaluate" expect heading "Decide" snap decision-screen-live`. The snapshot has the posture badge, `Confidence:`, `Live evaluation,`, `Decide by`, and `left to decide`. `browser.log` has `net POST <API_URL>/api/facilities/1/recommendations -> 201`.
- **Reason required on defer.** Run `RUN_ID=<id> $V browser goto /facilities/1 click button "Defer" select "Re-check in" "30 min" select "Reason category" "Road reports" select "Recorded by" "Dana Whitfield, County Executive Director" click button "Record deferral" expect-text "Enter a reason." snap decision-screen-defer-reason`. No `net POST …/decisions` line follows the click.
- **Override with a directive.** Run `RUN_ID=<id> $V browser goto /facilities/1 click button "Override" select "Posture instead" "<other>" select "Reason category" "Road reports" fill "Reason" "County reports ice on Route 9." select "Recorded by" "Dana Whitfield, County Executive Director" click button "Record override" expect-text "Decision recorded." select "Applies to" "Annex" select "Directive" "Excused" select "Reason category" "Local conditions" fill "Reason" "The Annex has no heat." select "Recorded by" "Marcus Oyelaran, State Administrative Officer" click button "Issue directive" expect-text "Directive issued." snap decision-screen-override-directive`. The snapshot lists `Annex: Excused` under `Directives`, and `Decision history` has an `Overrode` row. Read both back with `RUN_ID=<id> $V db decision-screen-rows "select d.id, d.action, d.chosen_posture, d.decided_by_name, x.scope, x.directive from decisions d left join decision_directives x on x.decision_id = d.id order by d.id"`.
- **Stale: someone else decided.** Run `RUN_ID=<id> $V browser goto /facilities/1 tab other goto /facilities/1 click button "Accept" within form "Accept the recommendation" select "Recorded by" "Marcus Oyelaran, State Administrative Officer" click button "Record acceptance" within-page expect-text "Decision recorded." tab main click button "Accept" within form "Accept the recommendation" select "Recorded by" "Dana Whitfield, County Executive Director" click button "Record acceptance" within-page expect-text "Someone else decided first." snap decision-screen-stale-decision`. Run it after a fresh evaluation so the recommendation has no decision yet, or add a reason to both accepts. `browser.log` has `[other] net POST …/decisions -> 201` and then `net POST …/decisions -> 409` from the main tab.
- **Stale: newer recommendation.** Run `RUN_ID=<id> $V browser goto /facilities/1 tab other goto /facilities/1 click button "Re-evaluate" expect-text "New recommendation loaded." tab main click button "Accept" within form "Accept the recommendation" select "Reason category" "Other" fill "Reason" "Holding normal operations." select "Recorded by" "Dana Whitfield, County Executive Director" click button "Record acceptance" within-page expect-text "A newer recommendation exists." snap decision-screen-stale-recommendation`. The main tab shows the newer recommendation's evaluation time.
- **Recorders API.** Run `RUN_ID=<id> $V api decision-screen-recorders GET /api/facilities/1/recorders`. `200` with Dana Whitfield, then Marcus Oyelaran.
- **Buildings API.** Run `RUN_ID=<id> $V api decision-screen-buildings GET /api/facilities/2/buildings`. `200` with one building `Main Office` (id `4`) and employees Uma Sorensen, Walt Hagen, Xenia Larsen.

## Gotchas

- Recommendations are live, so the posture changes between runs. Pick `<other>` from the badge in `decision-screen-live`.
- The second tab is a separate page in the same browser run, so `tab` steps share one `browser.log`. Lines from the second tab carry its name, such as `[other]`.
- Every change after the first decision needs a reason, even an accept.
- Once an accept or override is current, the Directives form repeats `Reason category`, `Reason`, and `Recorded by`. Wrap decision-form steps in `within form "<form heading>"`.
- `screen-backup` needs the clock to pass `decideBy` with no decision and then a re-evaluation. Leave the instance running past the deadline, or report it as not driven.
- The countdown updates on a 15-second tick and reads whole minutes, so two snapshots a few seconds apart can show the same text.
- Before the first evaluation, `GET …/recommendations/latest` answers `404`, so `browser.log` records a `console.error Failed to load resource … 404` line. A refused submit records a `409` line the same way. Both are expected.
