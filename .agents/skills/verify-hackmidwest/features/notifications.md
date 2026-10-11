# Notifications

A recommendation's notification preview shows who would be told what if it were accepted now, and writes nothing. Once a decision sets a posture, `GET /api/decisions/:id/notifications` returns the package for the decided posture: each recipient's channel, send-by time, late flag, and four-part message, plus everyone left out and why. `POST /api/decisions/:id/dispatch` records one `notification_dispatches` row per recipient, exactly once per decision, and reports each dispatch's lead time before the arrival window. Nothing is actually sent; the recorded package is the artifact.

## Sub-features

- `notifications-preview` returns the package for the recommended posture with `"source":{"kind":"preview",…}` and writes no `notification_dispatches` row.
- `notifications-decided` returns the decided package with `"source":{"kind":"decided",…}` and an empty `dispatches` list before dispatch.
- `notifications-dispatch` answers `201`, writes one row per recipient, and reports `minutesBeforeArrivalWindow` and `recordedAfterSendBy` for each.
- `notifications-dispatch-once` answers `409 {"conflict":"already_dispatched",…}` on a second dispatch and writes nothing more.
- `notifications-verify-after-dispatch` keeps `GET /api/decisions/:id/verify` intact with the dispatch rows on the chain.
- `notifications-no-posture` answers `409 {"conflict":"no_posture","action":"defer",…}` for a deferral on both the read and the dispatch.
- `notifications-superseded` answers `409 {"conflict":"decision_superseded","latestDecisionId":<id>}` when dispatching a decision a later one replaced.
- `notifications-not-found` answers `404` for an unknown recommendation or decision.
- `notifications-untimed` answers `409 {"conflict":"untimed_posture",…}` for an override to a delayed arrival or early dismissal that no finding timed. Reaching it needs a hazard that times nothing, so it is covered by unit tests, not this recipe.

## How to get to it (user POV)

- `GET /api/recommendations/:id/notifications/preview`.
- `GET /api/decisions/:id/notifications`.
- `POST /api/decisions/:id/dispatch` with no body.
- The decision screen's confirmation step and Dispatch action call these routes.

## Driving it with verify.sh

Preconditions:

- Baseline state from the index on a fresh `up`, so recommendation and decision ids start at `1`.
- Run the recipe before 05:00 in the facility's zone (10:00Z for Kansas City and Fargo in October), so each recommendation's `decideBy` is still ahead and a deferral can land before it.
- Recommendations come from the live NWS and Open-Meteo pull. Read each one's `posture` and pick an override posture that differs from it (the commands below assume `normal`).

Steps:

- **Recommend.** Run `RUN_ID=<id> $V api notifications-recommend POST /api/facilities/1/recommendations`. `201` with `"id":1`.
- **Preview.** Run `RUN_ID=<id> $V api notifications-preview GET /api/recommendations/1/notifications/preview`. `200` with `"source":{"kind":"preview","recommendationId":1}`, the recommended `posture`, and `recipients` plus `exclusions` that together list each Kansas City employee once, with Victor Lindgren as `"kind":"unmatched","reason":"not_in_hr"`.
- **Preview wrote nothing.** Run `RUN_ID=<id> $V db notifications-preview-no-rows "select count(*) as dispatches from notification_dispatches"`. `0`.
- **Decide.** Run `RUN_ID=<id> $V api notifications-decide POST /api/recommendations/1/decisions '{"action":"override","chosenPosture":"full_closure","decidedById":1,"reason":{"category":"local_conditions","text":"Water main break on site"}}'`. `201` with `"id":1`.
- **Decided package.** Run `RUN_ID=<id> $V api notifications-decided GET /api/decisions/1/notifications`. `200` with `"source":{"kind":"decided","decisionId":1}`, `"posture":{"posture":"full_closure"}`, `"dispatches":[]`, and recipients whose `message.subject` reads `Kansas City Area Service Center is closed on <facilityDate>`.
- **Dispatch.** Run `RUN_ID=<id> $V api notifications-dispatch POST /api/decisions/1/dispatch`. `201` with one `dispatches` entry per recipient, each with `plannedAt` equal to the recipient's `sendBy` and a positive `minutesBeforeArrivalWindow`.
- **Dispatch again.** Run `RUN_ID=<id> $V api notifications-dispatch-again POST /api/decisions/1/dispatch`. `409` with `"conflict":"already_dispatched"` and the first dispatch's `recordedAt`.
- **Stored dispatches.** Run `RUN_ID=<id> $V db notifications-dispatch-rows "select d.id, d.decision_id, d.decision_hash = (select content_hash from decisions where id = d.decision_id) as hash_matches, d.employee_id, d.channel, d.send_by, d.recorded_at from notification_dispatches d order by d.id"`. One row per recipient from the dispatch, each `hash_matches` `1`, all with the same `recorded_at`.
- **Verify after dispatch.** Run `RUN_ID=<id> $V api notifications-verify GET /api/decisions/1/verify`. `200` with `{"decisionId":1,"intact":true,"breaks":[]}`.
- **Defer elsewhere.** Run `RUN_ID=<id> $V api notifications-recommend-fargo POST /api/facilities/2/recommendations` (`201`, `"id":2`), then `RUN_ID=<id> $V api notifications-defer POST /api/recommendations/2/decisions '{"action":"defer","recheckAt":"<an instant between now and decideBy>","decidedById":5,"reason":{"category":"road_reports","text":"Waiting on the county road report."}}'` (`201`, `"id":2`).
- **No posture.** Run `RUN_ID=<id> $V api notifications-no-posture GET /api/decisions/2/notifications`. `409` with `"conflict":"no_posture","action":"defer"`.
- **Superseded.** Run `RUN_ID=<id> $V api notifications-supersede POST /api/recommendations/2/decisions '{"action":"accept","decidedById":5,"supersedesDecisionId":2,"reason":{"category":"road_reports","text":"County says the roads are clear."}}'` (`201`, `"id":3`), then `RUN_ID=<id> $V api notifications-superseded POST /api/decisions/2/dispatch`. `409` with `"conflict":"decision_superseded","latestDecisionId":3`.
- **Not found.** Run `RUN_ID=<id> $V api notifications-preview-unknown GET /api/recommendations/999/notifications/preview` and `RUN_ID=<id> $V api notifications-dispatch-unknown POST /api/decisions/999/dispatch`. `404` with `{"message":"Recommendation not found"}` and `{"message":"Decision not found"}`.
- **Only decision 1 dispatched.** Run `RUN_ID=<id> $V db notifications-dispatched-decisions "select decision_id, count(*) from notification_dispatches group by decision_id"`. One row, decision `1`.

## Gotchas

- Live weather picks the recommended posture. On a calm day it is `normal`, the preview has no recipients, and every employee is an exclusion with `no_change`. The override to `full_closure` is what gives the decided package recipients.
- An override must differ from the recommended posture, or the decision is `422`. Read the recommendation first.
- `sendBy`, `late`, and the message wording depend on the API clock against each employee's start time. Assert their presence and consistency, not fixed values.
- A dispatch with nobody to notify answers `201` with no rows, and the decision still reads as undispatched.
- Directives on a decision change who is notified. This recipe issues none.
