# Personnel status

A facility's decision maker or its backup records where an employee stands through `POST /api/employees/:id/status`. Each record is a new add-only event, never an edit. `GET /api/facilities/:id/personnel` lists everyone assigned to the facility. Each person comes back with their baseline status (the latest event in effect), their newest event (which may be scheduled for later), and their effective status for today. The effective status is resolved from the facility's newest decision and that decision's directives, and it names its cause. The top of the response names the current decision, the facility's buildings, and the two people who may record a status.

## Sub-features

- `personnel-status-record` records an event effective now, or a scheduled one when `effectiveFrom` is later, and answers `201` with the stored row.
- `personnel-status-reporter` answers `422` naming `/reportedById` when the reporter is missing or is not the facility's decision maker or backup.
- `personnel-status-unknown-field` answers `422` naming the field when the body has a field the route does not take.
- `personnel-status-note` answers `422` naming `/note` for a `not_working` status without a note.
- `personnel-status-not-found` answers `404` for an unknown employee, and `GET` answers `404` for an unknown facility.
- `personnel-baseline` shows the latest event in effect as the baseline, and a scheduled event only as `latestEvent`.
- `personnel-decided` resolves each person against the current decision's posture. Essential staff get `report_required`, telework-eligible staff get `teleworking`, and onsite-only staff get `dismissed` under a full closure. People already teleworking or not working keep their baseline.
- `personnel-directive` applies the current decision's directives over the posture, with `cause.source` `directive`.
- `personnel-facility-day` applies the newest decision only while its recommendation is about the current facility day. That day is today until closing, then tomorrow.
- `personnel-untimed` returns people without `effective` when the current decision overrides to a delayed arrival or early dismissal that no recommendation timed.
- `personnel-status-add-only` rejects `UPDATE` and `DELETE` on `employee_status_events` in storage.

## How to get to it (user POV)

- `POST /api/employees/:id/status` with `{"status", "note"?, "reportedById", "effectiveFrom"?}`.
- `GET /api/facilities/:id/personnel`.

## Driving it with verify.sh

Preconditions:

- Baseline state from the index on a fresh `up`, so recommendation, decision, and directive ids start at `1` and the next status event id is `30`.
- The steps below build on each other. Run them in order.
- Kansas City (facility `1`) is decided by Dana Whitfield (`1`), with Marcus Oyelaran (`2`) as backup. Grace Lindqvist (`5`) decides for Fargo only. Building `2` is the Kansas City Annex. Employee `1` is Avery Calloway, telework eligible. Employee `2` is Bianca Ferraro, essential. Employee `5` is Elliot Brandt, onsite only. Employee `8` is Hana Kowalczyk.
- Define `REASON='"reason":{"category":"road_reports","text":"County reports the highway closed."}'` in the same shell command as the steps that use it.

- **Baseline before anything is decided.** Run `RUN_ID=<id> $V api personnel-baseline GET /api/facilities/1/personnel`. `200` with `"decision":null`, `"posture":{"kind":"none"}`, `"recorders"` listing ids `1` then `2`, and `buildings` `1` `Main Office`, `2` `Annex`, `3` `Equipment Barn`. Employee `4` shows `"effective":{"kind":"teleworking","cause":{"source":"baseline",…}}`. Employee `8` has `"hasAccessibilityNeeds":true` and no `accessibilityNeeds` text.
- **Record a status.** Run `RUN_ID=<id> $V api personnel-status-telework POST /api/employees/1/status '{"status":"teleworking","reportedById":1}'`. `201` with `"id":30`, `"employeeId":1`, `"status":"teleworking"`, `"note":null`, and `effectiveFrom` equal to `reportedAt`.
- **Schedule a status.** Run `RUN_ID=<id> $V api personnel-status-scheduled POST /api/employees/1/status '{"status":"not_working","note":"Family leave starts Friday.","reportedById":2,"effectiveFrom":"2099-01-01T14:00:00.000Z"}'`. `201` with `"id":31` and `"effectiveFrom":"2099-01-01T14:00:00.000Z"`.
- **Reporter required.** Run `RUN_ID=<id> $V api personnel-status-no-reporter POST /api/employees/1/status '{"status":"teleworking"}'`. `422` with body `{"type":"validation","on":"body","property":"/reportedById","message":"Expected required property"}`.
- **Reporter from another facility.** Run `RUN_ID=<id> $V api personnel-status-ineligible POST /api/employees/1/status '{"status":"teleworking","reportedById":5}'`. `422` with `"property":"/reportedById"` and `"message":"Only the facility's decision maker or its backup can record a status"`.
- **Unknown field.** Run `RUN_ID=<id> $V api personnel-status-unknown-field POST /api/employees/1/status '{"status":"teleworking","reportedById":1,"employeeId":2}'`. `422` with `"property":"/employeeId"` and `"message":"Unexpected property"`. Nothing is stored.
- **Note required.** Run `RUN_ID=<id> $V api personnel-status-no-note POST /api/employees/1/status '{"status":"not_working","reportedById":1}'`. `422` with `"property":"/note"` and `"message":"A not_working status needs a note"`.
- **Not found.** Run `RUN_ID=<id> $V api personnel-status-unknown POST /api/employees/999/status '{"status":"teleworking","reportedById":1}'` and `RUN_ID=<id> $V api personnel-unknown GET /api/facilities/999/personnel`. `404` with `{"message":"Employee not found"}` and `{"message":"Facility not found"}`.
- **Latest event in effect wins.** Run `RUN_ID=<id> $V api personnel-after-status GET /api/facilities/1/personnel`. Employee `1` has `"baseline":{"status":"teleworking",…}` with event `30`, and `latestEvent` is event `31`, the scheduled `not_working`.
- **Stored events.** Run `RUN_ID=<id> $V db personnel-status-rows "select id, employee_id, status, note, reported_by_id, effective_from = reported_at as effective_now from employee_status_events where employee_id = 1 order by id"`. Rows `1|1|working_onsite||1|1`, `30|1|teleworking||1|1`, and `31|1|not_working|Family leave starts Friday.|2|0`. Rejected requests stored nothing.
- **Decide a full closure.** Run `RUN_ID=<id> $V api personnel-recommendation POST /api/facilities/1/recommendations '{}'` (`201`, `"id":1`, live weather). Then run `RUN_ID=<id> $V api personnel-decide-closure POST /api/recommendations/1/decisions "{\"action\":\"override\",\"chosenPosture\":\"full_closure\",\"decidedById\":1,$REASON}"`. `201` with `"id":1`.
- **Excuse the Annex.** Run `RUN_ID=<id> $V api personnel-directive-annex POST /api/decisions/1/directives "{\"scope\":{\"kind\":\"building\",\"buildingId\":2},\"directive\":\"excused\",$REASON,\"issuedById\":1}"`. `201` with `"id":1`.
- **Release one person early.** Run `RUN_ID=<id> $V api personnel-directive-release POST /api/decisions/1/directives '{"scope":{"kind":"employee","employeeId":8},"directive":"dismissed","effectiveAt":"2099-01-01T18:00:00.000Z","reason":{"category":"local_conditions","text":"The accessible entrance is not cleared."},"issuedById":1}'`. `201` with `"id":2`.
- **Effective status under the decision.** Run `RUN_ID=<id> $V api personnel-decided GET /api/facilities/1/personnel`. `200` with `"decision":{"id":1,…,"action":"override"}` and `"posture":{"kind":"decided","posture":{"posture":"full_closure"}}`. Employee `2` is `report_required` with cause `posture`. Employee `5` is `dismissed` with `"release":"all_day"`. Employee `1` stays `teleworking` with cause `baseline`. Employees `10`, `11`, `14`, `16`, and `19` in the Annex are `not_working` with note `County reports the highway closed.` and cause `directive`. Employee `7` in the Annex stays `not_working` (`On annual leave through October 16.`) with cause `baseline`. Employee `8` is `dismissed` with `"release":{"at":"2099-01-01T18:00:00.000Z"}` and cause `directive`.
- **Untimed override.** Run `RUN_ID=<id> $V api personnel-decide-untimed POST /api/recommendations/1/decisions "{\"action\":\"override\",\"chosenPosture\":\"early_dismissal\",\"decidedById\":1,\"supersedesDecisionId\":1,$REASON}"` (`201`, `"id":2`). Then run `RUN_ID=<id> $V api personnel-untimed GET /api/facilities/1/personnel`. `200` with `"decision":{"id":2,…}`, `"posture":{"kind":"untimed","posture":"early_dismissal"}`, and no `effective` on any person.
- **Add-only storage.** Run `RUN_ID=<id> $V db-reject personnel-status-update "update employee_status_events set status = 'working_onsite' where id = 30" "employee_status_events is add-only: record a newer event instead of updating one"` and `RUN_ID=<id> $V db-reject personnel-status-delete "delete from employee_status_events where id = 30" "employee_status_events is add-only: events cannot be deleted"`. Each exits `0` with `verdict> rejected` and `snapshot unchanged> yes`.

## Gotchas

- `POST /api/facilities/1/recommendations` pulls live weather, and an override must choose a posture other than the recommended one. If the live posture is `full_closure`, override to `unscheduled_telework` instead, and expect telework-eligible staff to telework and onsite-only staff to work onsite. If it is `early_dismissal`, run the untimed step with `"chosenPosture":"delayed_arrival"` and expect `"posture":"delayed_arrival"`. If the live recommendation times the posture you chose, the untimed step returns `decided` instead. Report that, and don't count it as untimed proof.
- A decision applies only while its recommendation is about the current facility day. That day is today until the facility's closing time, then tomorrow. A recommendation and the personnel read made minutes apart always agree, but a decision from an earlier run of the recipe on another day does not apply.
- Directives belong to one decision. After the untimed override supersedes decision `1`, the Annex and early-release directives no longer apply, and a new directive on decision `1` answers `409`.
- A person already teleworking or not working keeps that baseline under any facility-wide posture or building directive. Only an employee-scoped directive reaches them.
- `reportedAt` is the API's clock, so assert `effective_now`, not the timestamp.
