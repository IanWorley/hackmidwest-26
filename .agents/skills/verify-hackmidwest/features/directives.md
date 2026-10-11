# Directives

A decision maker layers directives on the current decision: `report`, `telework`, `dismissed`, or `excused`, for the whole facility, the essential group, one building, or one employee. `POST /api/decisions/:id/directives` stores each as an add-only `decision_directives` row that copies the decision's content hash, so the record shows which decision it qualifies. The scope comes back as a typed object, such as `{"kind":"building","buildingId":2}`. A building or employee must belong to the decision's facility. A directive on a decision that a newer one superseded is refused with a `409` naming the current decision. `GET /api/decisions/:id/directives` lists a decision's directives, and `GET /api/decisions/:id/verify` checks each directive's hash and its link to the decision.

## Sub-features

- `directives-facility` returns `201` with `"scope":{"kind":"facility"}`, `decisionHash` equal to the decision's `contentHash`, `issuedAt` set by the server, and `effectiveAt: null`.
- `directives-essential` returns `201` with `"scope":{"kind":"group","group":"essential"}`.
- `directives-building` returns `201` with `"scope":{"kind":"building","buildingId":<id>}` for a building in the decision's facility.
- `directives-employee` returns `201` with `"scope":{"kind":"employee","employeeId":<id>}`, and on a `dismissed` directive stores `effectiveAt` in `toISOString` form.
- `directives-list` returns the decision's directives in issue order, and `404 {"message":"Decision not found"}` for an unknown decision.
- `directives-invalid` returns `422 {"message":"Invalid directive","field":"<path>"}` for a missing or blank reason, an `effectiveAt` on any directive but `dismissed`, an issuer who is not a `decision_makers` row, an unknown field, or a building or employee outside the decision's facility (`"field":"scope"`).
- `directives-superseded` returns `409 {"conflict":"decision_superseded",…,"latestDecisionId":<id>}` for a decision that has a successor.
- `directives-verify` adds one `"kind":"directive"` link per directive to `GET /api/decisions/:id/verify`.
- `directives-add-only` rejects an `UPDATE` of a stored directive.

## How to get to it (user POV)

- Send `POST /api/decisions/<id>/directives` to `$API_URL` with `{"scope":{…},"directive":"…","reason":{"category":"…","text":"…"},"issuedById":<n>}`, plus `effectiveAt` on a dismissal. The decision screen will call this.
- Send `GET /api/decisions/<id>/directives`.
- Send `GET /api/decisions/<id>/verify`.

## Driving it with verify.sh

Preconditions:

- Baseline state from the index, then one evaluation and one accept: `RUN_ID=<id> $V api directives-evaluate POST /api/facilities/1/recommendations` and `RUN_ID=<id> $V api directives-accept POST /api/recommendations/1/decisions '{"action":"accept","decidedById":1}'`. Decision `1` is on Kansas City (facility `1`), whose buildings are `1` to `3`. Building `4` and employee `21` are in Fargo.

- **Facility scope.** Run `RUN_ID=<id> $V api directives-facility POST /api/decisions/1/directives '{"scope":{"kind":"facility"},"directive":"telework","reason":{"category":"road_reports","text":"County reports ice on Route 9."},"issuedById":1}'`. `201`; `"id":1`, `"decisionId":1`, `"scope":{"kind":"facility"}`, `"effectiveAt":null`.
- **Essential group.** Run `RUN_ID=<id> $V api directives-essential POST /api/decisions/1/directives '{"scope":{"kind":"group","group":"essential"},"directive":"report","reason":{"category":"essential_operations","text":"Plant operators keep the boilers running."},"issuedById":1}'`. `201`; `"id":2`.
- **Building scope.** Run `RUN_ID=<id> $V api directives-building POST /api/decisions/1/directives '{"scope":{"kind":"building","buildingId":2},"directive":"excused","reason":{"category":"local_conditions","text":"The Annex has no heat."},"issuedById":2}'`. `201`; `"id":3`, `"scope":{"kind":"building","buildingId":2}`, `"issuedById":2`.
- **Employee scope.** Run `RUN_ID=<id> $V api directives-employee POST /api/decisions/1/directives '{"scope":{"kind":"employee","employeeId":8},"directive":"dismissed","effectiveAt":"2026-10-12T11:30:00-05:00","reason":{"category":"road_reports","text":"The accessible entrance will not be cleared after 11:30."},"issuedById":1}'`. `201`; `"id":4`, `"effectiveAt":"2026-10-12T16:30:00.000Z"`.
- **List.** Run `RUN_ID=<id> $V api directives-list GET /api/decisions/1/directives`. `200`; ids `1` to `4` in order with typed scopes. `RUN_ID=<id> $V api directives-list-unknown GET /api/decisions/999/directives` answers `404 {"message":"Decision not found"}`.
- **Reason required.** Run `RUN_ID=<id> $V api directives-no-reason POST /api/decisions/1/directives '{"scope":{"kind":"facility"},"directive":"report","issuedById":1}'`. `422 {"message":"Invalid directive","field":"reason"}`.
- **Release time only on a dismissal.** Run `RUN_ID=<id> $V api directives-effective-at-on-report POST /api/decisions/1/directives '{"scope":{"kind":"facility"},"directive":"report","effectiveAt":"2026-10-12T16:30:00Z","reason":{"category":"other","text":"Stay late."},"issuedById":1}'`. `422` with `"field":"effectiveAt"`.
- **Other facility.** Run `RUN_ID=<id> $V api directives-other-facility-building POST /api/decisions/1/directives '{"scope":{"kind":"building","buildingId":4},"directive":"excused","reason":{"category":"other","text":"Wrong site."},"issuedById":1}'` and the same with `{"kind":"employee","employeeId":21}` as `directives-other-facility-employee`. Each `422` with `"field":"scope"`.
- **Unknown issuer.** Run `RUN_ID=<id> $V api directives-unknown-issuer POST /api/decisions/1/directives '{"scope":{"kind":"facility"},"directive":"report","reason":{"category":"other","text":"Stay."},"issuedById":999}'`. `422` with `"field":"issuedById"`.
- **Verify.** Run `RUN_ID=<id> $V api directives-verify GET /api/decisions/1/verify`. `200`; `"ok":true` with links `recommendation 1`, `decision 1`, then `directive 1` to `directive 4`, each `"ok":true`.
- **Stored rows.** Run `RUN_ID=<id> $V db directives-rows "select id, decision_id, scope, directive, effective_at, reason_category, issued_by_id, issued_at, decision_hash = (select content_hash from decisions d where d.id = decision_id) as hash_matches from decision_directives order by id"`. Four rows match the responses, with scope text `facility`, `group:essential`, `building:2`, `employee:8`, and `hash_matches` `1` on each.
- **Add-only.** Run `RUN_ID=<id> $V db-reject directives-update "update decision_directives set directive = 'report' where id = 4" "decision_directives is add-only: record a newer directive instead of updating one"`. `verdict> rejected`.
- **Superseded decision.** Run `RUN_ID=<id> $V api directives-supersede POST /api/recommendations/1/decisions '{"action":"override","posture":"<other>","reason":{"category":"road_reports","text":"County reports ice on Route 9."},"supersedesDecisionId":1,"decidedById":1}'` (`201`, id `2`), then `RUN_ID=<id> $V api directives-superseded POST /api/decisions/1/directives '{"scope":{"kind":"facility"},"directive":"report","reason":{"category":"other","text":"Too late."},"issuedById":1}'`. `409 {"conflict":"decision_superseded",…,"latestDecisionId":2}`.

## Gotchas

- Run the superseded step last. It adds decision `2`, and every later directive must target `2`.
- `<other>` is any posture but the one the evaluation recommended; recommendations are live, so read it from `directives-evaluate`.
- Directives stay in the database. Start from a fresh `up` so the ids hold.
- Nothing yet reads directives to change who is notified; that waits on the notification package (#29).
