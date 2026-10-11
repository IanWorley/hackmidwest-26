# Notifications

A recommendation's notification preview shows who would be told what if it were accepted now, and writes nothing. Once a decision sets a posture, `GET /api/decisions/:id/notifications` returns the package for the decided posture: each recipient's channel, send-by time, late flag, and four-part message, plus everyone left out and why. `POST /api/decisions/:id/dispatch` takes `{"packageHash":…}`, the hash of the package as `GET …/notifications` showed it, and records one `notification_dispatches` row per recipient, exactly once per decision, only while the package is still that one, and reports each dispatch's lead time before the arrival window. Nothing is actually sent; the recorded package is the artifact.

## Sub-features

- `notifications-preview` returns the package for the recommended posture with `"source":{"kind":"preview",…}` and writes no `notification_dispatches` row.
- `notifications-decided` returns the decided package with `"source":{"kind":"decided",…}` and an empty `dispatches` list before dispatch.
- `notifications-directive` applies the decision's stored directives, so an employee a directive excuses moves from the recipients to the exclusions with the directive's reason.
- `notifications-dispatch` answers `201`, writes one row per recipient, and reports `minutesBeforeArrivalWindow` and `recordedAfterSendBy` for each.
- `notifications-package-changed` answers `409 {"conflict":"package_changed","packageHash":<current>,…}` when the package changed after it was read, such as after a directive, and writes nothing.
- `notifications-dispatch-once` answers `409 {"conflict":"already_dispatched",…}` on a second dispatch and writes nothing more.
- `notifications-directive-after-dispatch` answers `409 {"conflict":"already_dispatched","currentDecisionId":<id>,"recordedAt":…}` for a directive on a dispatched decision and writes no `decision_directives` row, so the recorded package stays the one staff got.
- `notifications-verify-after-dispatch` keeps `GET /api/decisions/:id/verify` intact with the dispatch rows on the chain.
- `notifications-no-posture` answers `409 {"conflict":"no_posture","action":"defer",…}` for a deferral on both the read and the dispatch.
- `notifications-superseded` answers `409 {"conflict":"not_current_decision","currentDecisionId":<id or null>}` when dispatching a decision that is not the facility's current one: a later decision replaced it, on the same recommendation or a newer one, or its facility day has passed.
- `notifications-not-found` answers `404` for an unknown recommendation or decision.
- `notifications-untimed` answers `409 {"conflict":"untimed_posture",…}` on both the read and the dispatch for an override to a delayed arrival or early dismissal that no finding timed, and writes nothing.

## How to get to it (user POV)

- `GET /api/recommendations/:id/notifications/preview`.
- `GET /api/decisions/:id/notifications`.
- `POST /api/decisions/:id/dispatch` with `{"packageHash":"<packageHash from GET …/notifications>"}`. A body with any other field is `422`.
- On `/facilities/<id>`, the decision screen's `Confirm and notify` step reads the preview, and its `Notifications` region reads the decided package and calls dispatch (see [Decision screen](./decision-screen.md)).

## Driving it with verify.sh

Preconditions:

- Baseline state from the index on a fresh `up`, so recommendation and decision ids start at `1`.
- Run the recipe before 04:30 in the facility's zone (09:30Z for Kansas City and Fargo in October), so each recommendation's `decideBy` is at least 30 minutes ahead and the deferral below lands before it.
- Set the deferral's re-check time in the same shell command as the defer step: `RECHECK=$(date -u -d '+30 minutes' +%Y-%m-%dT%H:%M:%S.000Z)`.
- Recommendations come from the live NWS and Open-Meteo pull. The commands below assume Kansas City's is not `full_closure` and Yakima's is `normal`. When Kansas City's is `full_closure`, run the Decide step with `"chosenPosture":"unscheduled_telework"` instead; the rest of the recipe is unchanged.

Steps:

- **Recommend.** Run `RUN_ID=<id> $V api notifications-recommend POST /api/facilities/1/recommendations`. `201` with `"id":1`.
- **Preview.** Run `RUN_ID=<id> $V api notifications-preview GET /api/recommendations/1/notifications/preview`. `200` with `"source":{"kind":"preview","recommendationId":1}`, the recommended `posture`, and `recipients` plus `exclusions` that together list each Kansas City employee once, with Victor Lindgren as `"kind":"unmatched","reason":"not_in_hr"` and his roster entry's `rosterEntryId`.
- **Preview wrote nothing.** Run `RUN_ID=<id> $V db notifications-preview-no-rows "select count(*) as dispatches from notification_dispatches"`. `0`.
- **Decide.** Run `RUN_ID=<id> $V api notifications-decide POST /api/recommendations/1/decisions '{"action":"override","chosenPosture":"full_closure","decidedById":1,"reason":{"category":"local_conditions","text":"Water main break on site"}}'`. `201` with `"id":1`.
- **Decided package.** Run `RUN_ID=<id> $V api notifications-decided GET /api/decisions/1/notifications`. `200` with `"source":{"kind":"decided","decisionId":1}`, `"posture":{"posture":"full_closure"}`, `"dispatches":[]`, and recipients whose `message.subject` reads `Kansas City Area Service Center is closed on <facilityDate>`. On the `unscheduled_telework` branch, expect `"posture":{"posture":"unscheduled_telework"}` and the subject `Kansas City Area Service Center is on unscheduled telework on <facilityDate>`. The recipient count can differ from the full closure, and every later step is stated relative to this package, so the rest of the recipe holds on either branch. Keep this package's hash for the Package changed step: `source /tmp/verify-hackmidwest/runs/<id>/state.env; curl -s "$API_URL/api/decisions/1/notifications" | jq -r .packageHash > /tmp/verify-hackmidwest/runs/<id>/reviewed-hash`.
- **Directive.** Run `RUN_ID=<id> $V api notifications-excuse POST /api/decisions/1/directives '{"scope":{"kind":"employee","employeeId":1},"directive":"excused","reason":{"category":"other","text":"Approved leave for a family emergency."},"issuedById":1}'` (`201`), then `RUN_ID=<id> $V api notifications-decided-excused GET /api/decisions/1/notifications`. `200` with one recipient fewer than the decided package, and Avery Calloway (employee `1`) listed under `exclusions` as `"kind":"excused"` with the reason text.
- **Package changed.** The directive changed the package after its hash was kept, so run `RUN_ID=<id> $V api notifications-package-changed POST /api/decisions/1/dispatch "{\"packageHash\":\"$(cat /tmp/verify-hackmidwest/runs/<id>/reviewed-hash)\"}"`. `409` with `"conflict":"package_changed"` and a `packageHash` that differs from the kept one and equals the one in `notifications-decided-excused`. Run `RUN_ID=<id> $V db notifications-package-changed-rows "select count(*) as dispatches from notification_dispatches"`. `0`.
- **Dispatch.** Run `source /tmp/verify-hackmidwest/runs/<id>/state.env; RUN_ID=<id> $V api notifications-dispatch POST /api/decisions/1/dispatch "{\"packageHash\":\"$(curl -s "$API_URL/api/decisions/1/notifications" | jq -r .packageHash)\"}"`. `201` with one `dispatches` entry per recipient, each with `plannedAt` equal to the recipient's `sendBy` and a positive `minutesBeforeArrivalWindow`.
- **Dispatch again.** Run `source /tmp/verify-hackmidwest/runs/<id>/state.env; RUN_ID=<id> $V api notifications-dispatch-again POST /api/decisions/1/dispatch "{\"packageHash\":\"$(curl -s "$API_URL/api/decisions/1/notifications" | jq -r .packageHash)\"}"`. `409` with `"conflict":"already_dispatched"` and the first dispatch's `recordedAt`.
- **Directive after dispatch.** Run `RUN_ID=<id> $V api notifications-directive-after-dispatch POST /api/decisions/1/directives '{"scope":{"kind":"employee","employeeId":2},"directive":"excused","reason":{"category":"other","text":"Too late to reach anyone."},"issuedById":1}'`. `409` with `{"conflict":"already_dispatched","currentDecisionId":1,"recordedAt":<the first dispatch's recordedAt>}`. Run `RUN_ID=<id> $V db notifications-directives-after-dispatch "select id, decision_id, scope, directive from decision_directives order by id"`. Only the Directive step's row (`1`, `employee:1`).
- **Stored dispatches.** Run `RUN_ID=<id> $V db notifications-dispatch-rows "select d.id, d.decision_id, d.decision_hash = (select content_hash from decisions where id = d.decision_id) as hash_matches, d.employee_id, d.channel, d.send_by, d.recorded_at from notification_dispatches d order by d.id"`. One row per recipient from the dispatch, each `hash_matches` `1`, all with the same `recorded_at`.
- **Verify after dispatch.** Run `RUN_ID=<id> $V api notifications-verify GET /api/decisions/1/verify`. `200` with `{"decisionId":1,"intact":true,"breaks":[]}`.
- **Defer elsewhere.** Run `RUN_ID=<id> $V api notifications-recommend-fargo POST /api/facilities/2/recommendations` (`201`, `"id":2`), then `RUN_ID=<id> $V api notifications-defer POST /api/recommendations/2/decisions "{\"action\":\"defer\",\"recheckAt\":\"$RECHECK\",\"decidedById\":5,\"reason\":{\"category\":\"road_reports\",\"text\":\"Waiting on the county road report.\"}}"` (`201`, `"id":2`).
- **No posture.** Run `RUN_ID=<id> $V api notifications-no-posture GET /api/decisions/2/notifications`. `409` with `"conflict":"no_posture","action":"defer"`. Run `RUN_ID=<id> $V api notifications-no-posture-dispatch POST /api/decisions/2/dispatch '{"packageHash":"never-shown"}'`; the same `409`, since a refusal comes before the package is compared.
- **Superseded.** Run `RUN_ID=<id> $V api notifications-supersede POST /api/recommendations/2/decisions '{"action":"accept","decidedById":5,"supersedesDecisionId":2,"reason":{"category":"road_reports","text":"County says the roads are clear."}}'` (`201`, `"id":3`), then `RUN_ID=<id> $V api notifications-superseded POST /api/decisions/2/dispatch '{"packageHash":"never-shown"}'`. `409` with `"conflict":"not_current_decision","currentDecisionId":3`.
- **Untimed override.** Run `RUN_ID=<id> $V api notifications-recommend-yakima POST /api/facilities/3/recommendations` (`201`, `"id":3`, posture `normal` with no thresholds crossed), then `RUN_ID=<id> $V api notifications-untimed-decide POST /api/recommendations/3/decisions '{"action":"override","chosenPosture":"early_dismissal","decidedById":3,"reason":{"category":"local_conditions","text":"Power is out at the Main Office."}}'` (`201`, `"id":4`). Run `RUN_ID=<id> $V api notifications-untimed GET /api/decisions/4/notifications` and `RUN_ID=<id> $V api notifications-untimed-dispatch POST /api/decisions/4/dispatch '{"packageHash":"never-shown"}'`. Both `409` with `"conflict":"untimed_posture","posture":"early_dismissal"`: nothing gave the dismissal a release time.
- **Not found.** Run `RUN_ID=<id> $V api notifications-preview-unknown GET /api/recommendations/999/notifications/preview` `RUN_ID=<id> $V api notifications-read-unknown GET /api/decisions/999/notifications`, and `RUN_ID=<id> $V api notifications-dispatch-unknown POST /api/decisions/999/dispatch '{"packageHash":"never-shown"}'`. `404` with `{"message":"Recommendation not found"}`, then `{"message":"Decision not found"}` for both decision routes.
- **Only decision 1 dispatched.** Run `RUN_ID=<id> $V db notifications-dispatched-decisions "select decision_id, count(*) from notification_dispatches group by decision_id"`. One row, decision `1`.

## Gotchas

- On a calm day nothing times a dismissal or a delay, so an override to either is `untimed_posture` by design. Notices never guess a release time.
- Live weather picks the recommended posture. On a calm day it is `normal`, the preview has no recipients, and every employee is an exclusion with `no_change`. The override to `full_closure` is what gives the decided package recipients.
- An override must differ from the recommended posture, or the decision is `422`. Read the recommendation first.
- `sendBy`, `late`, and the message wording depend on the API clock against each employee's start time. Assert their presence and consistency, not fixed values.
- A dispatch with nobody to notify answers `201` with no rows, and the decision still reads as undispatched.
- Directives on a decision change who is notified. Issue them before the dispatch; a dispatch records the package as it stood, and the API refuses a directive after it with `already_dispatched`.
