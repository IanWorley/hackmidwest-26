# Directives

A decision maker layers directives on the current decision: `report`, `telework`, `dismissed`, or `excused`, for the whole facility, the essential group, one building, or one employee. `POST /api/decisions/:id/directives` stores each as an add-only `decision_directives` row that copies the decision's content hash, so the record shows which decision it qualifies. The scope comes back as a typed object, such as `{"kind":"building","buildingId":2}`. Only the facility's decision maker or its backup may issue one, and a building or employee must belong to the decision's facility. A directive on a decision that a newer one superseded is refused with a `409` naming the newest decision. `GET /api/decisions/:id/directives` lists a decision's directives, and `GET /api/decisions/:id/verify` checks each directive's hash and its link to the decision.

## Sub-features

- `directives-facility` returns `201` with `"scope":{"kind":"facility"}`, `decisionHash` equal to the decision's `contentHash`, `issuedAt` set by the server, and `effectiveAt: null`.
- `directives-essential` returns `201` with `"scope":{"kind":"group","group":"essential"}`.
- `directives-building` returns `201` with `"scope":{"kind":"building","buildingId":<id>}` for a building in the decision's facility, issued here by the facility's backup decision maker.
- `directives-employee` returns `201` with `"scope":{"kind":"employee","employeeId":<id>}` and, on a `dismissed` directive, the `effectiveAt` release time.
- `directives-list` returns the decision's directives in issue order, and `404 {"message":"Decision not found"}` for an unknown decision.
- `directives-invalid` returns `422 {"type":"validation","on":"body","property":"<pointer>","message":"…"}` for a missing reason (`/reason`), an `effectiveAt` on any directive but `dismissed` (`/effectiveAt`), an `effectiveAt` that is not a `toISOString` instant with a four-digit year (`/effectiveAt`), an issuer who is not the facility's decision maker or backup (`/issuedById`), or a building or employee outside the decision's facility (`/scope`).
- `directives-superseded` returns `409 {"conflict":"newer_decision","latestDecisionId":<id>}` for a decision that has a successor.
- `directives-verify` walks each directive as a leaf under its decision in `GET /api/decisions/:id/verify`, so an altered directive appears in `breaks` as `"record":"directive"`.
- `directives-add-only` rejects an `UPDATE` of a stored directive.

## How to get to it (user POV)

- Send `POST /api/decisions/<id>/directives` to `$API_URL` with `{"scope":{…},"directive":"…","reason":{"category":"…","text":"…"},"issuedById":<n>}`, plus `effectiveAt` on a dismissal. The decision screen will call this.
- Send `GET /api/decisions/<id>/directives`.
- Send `GET /api/decisions/<id>/verify`.

## Driving it with verify.sh

Preconditions:

- Baseline state from the index on a fresh `up`, so recommendation, decision, and directive ids start at `1`.
- Staging exception, the same as [decisions](./decisions.md): no route creates recommendations yet, so define `rec` and `stage` exactly as that recipe does (with `DECIDE_BY=2099-10-02T11:00:00.000Z`) in the same shell command, then run `stage 2026-10-02T10:00:00.000Z 1 "$(rec 2026-10-02T10:00:00.000Z 1 | sha256sum | cut -c1-64)"`. Record it with `RUN_ID=<id> $V db directives-staged-recommendation "select id, facility_id, posture, content_hash from recommendations order by id"`.
- Accept it: `RUN_ID=<id> $V api directives-accept POST /api/recommendations/1/decisions '{"action":"accept","decidedById":1}'` (`201`, `"id":1`). Decision `1` is on Kansas City (facility `1`), whose buildings are `1` to `3`; Dana Whitfield (`1`) decides and Marcus Oyelaran (`2`) is the backup. Building `4`, employee `21`, and Grace Lindqvist (`5`) belong to Fargo.

- **Facility scope.** Run `RUN_ID=<id> $V api directives-facility POST /api/decisions/1/directives '{"scope":{"kind":"facility"},"directive":"telework","reason":{"category":"road_reports","text":"County reports ice on Route 9."},"issuedById":1}'`. `201`; `"id":1`, `"decisionId":1`, `"scope":{"kind":"facility"}`, `"effectiveAt":null`.
- **Essential group.** Run `RUN_ID=<id> $V api directives-essential POST /api/decisions/1/directives '{"scope":{"kind":"group","group":"essential"},"directive":"report","reason":{"category":"essential_operations","text":"Plant operators keep the boilers running."},"issuedById":1}'`. `201`; `"id":2`.
- **Building scope.** Run `RUN_ID=<id> $V api directives-building POST /api/decisions/1/directives '{"scope":{"kind":"building","buildingId":2},"directive":"excused","reason":{"category":"local_conditions","text":"The Annex has no heat."},"issuedById":2}'`. `201`; `"id":3`, `"scope":{"kind":"building","buildingId":2}`, `"issuedById":2`.
- **Employee scope.** Run `RUN_ID=<id> $V api directives-employee POST /api/decisions/1/directives '{"scope":{"kind":"employee","employeeId":8},"directive":"dismissed","effectiveAt":"2099-10-02T16:30:00.000Z","reason":{"category":"road_reports","text":"The accessible entrance will not be cleared after 11:30."},"issuedById":1}'`. `201`; `"id":4`, `"effectiveAt":"2099-10-02T16:30:00.000Z"`.
- **List.** Run `RUN_ID=<id> $V api directives-list GET /api/decisions/1/directives`. `200`; ids `1` to `4` in order with typed scopes. `RUN_ID=<id> $V api directives-list-unknown GET /api/decisions/999/directives` answers `404 {"message":"Decision not found"}`.
- **Reason required.** Run `RUN_ID=<id> $V api directives-no-reason POST /api/decisions/1/directives '{"scope":{"kind":"facility"},"directive":"report","issuedById":1}'`. `422 {"type":"validation","on":"body","property":"/reason","message":"Expected required property"}`.
- **Release time only on a dismissal.** Run `RUN_ID=<id> $V api directives-effective-at-on-report POST /api/decisions/1/directives '{"scope":{"kind":"facility"},"directive":"report","effectiveAt":"2099-10-02T16:30:00.000Z","reason":{"category":"other","text":"Stay late."},"issuedById":1}'`. `422` with `"property":"/effectiveAt"` and `"message":"Only a dismissed directive takes an effectiveAt release time"`.
- **Impossible release time.** Run `RUN_ID=<id> $V api directives-extended-year POST /api/decisions/1/directives '{"scope":{"kind":"employee","employeeId":8},"directive":"dismissed","effectiveAt":"-000001-01-01T00:00:00.000Z","reason":{"category":"other","text":"Edge."},"issuedById":1}'`, and the same with `"2026-02-30T10:00:00.000Z"` as `directives-impossible-date`. Each `422` with `"property":"/effectiveAt"` and `"message":"Expected string to match 'utc-instant' format"`.
- **Other facility.** Run `RUN_ID=<id> $V api directives-other-facility-building POST /api/decisions/1/directives '{"scope":{"kind":"building","buildingId":4},"directive":"excused","reason":{"category":"other","text":"Wrong site."},"issuedById":1}'` and the same with `{"kind":"employee","employeeId":21}` as `directives-other-facility-employee`. Each `422` with `"property":"/scope"` and `"message":"The scope must name a building or employee of the decision's facility"`.
- **Ineligible issuer.** Run `RUN_ID=<id> $V api directives-other-facility-issuer POST /api/decisions/1/directives '{"scope":{"kind":"facility"},"directive":"report","reason":{"category":"other","text":"Stay."},"issuedById":5}'` and the same with `"issuedById":999` as `directives-unknown-issuer`. Each `422` with `"property":"/issuedById"` and `"message":"Only the facility's decision maker or its backup can issue a directive"`.
- **Verify intact.** Run `RUN_ID=<id> $V api directives-verify GET /api/decisions/1/verify`. `200` with `{"decisionId":1,"intact":true,"breaks":[]}`.
- **Stored rows.** Run `RUN_ID=<id> $V db directives-rows "select id, decision_id, scope, directive, effective_at, reason_category, issued_by_id, decision_hash = (select content_hash from decisions d where d.id = decision_id) as hash_matches from decision_directives order by id"`. Rows `1|1|facility|telework||road_reports|1|1`, `2|1|group:essential|report||essential_operations|1|1`, `3|1|building:2|excused||local_conditions|2|1`, `4|1|employee:8|dismissed|2099-10-02T16:30:00.000Z|road_reports|1|1`.
- **Add-only.** Run `RUN_ID=<id> $V db-reject directives-update "update decision_directives set directive = 'report' where id = 4" "decision_directives is add-only: record a newer directive instead of updating one"`. `verdict> rejected`.
- **Superseded decision.** Run `RUN_ID=<id> $V api directives-supersede POST /api/recommendations/1/decisions '{"action":"override","chosenPosture":"full_closure","decidedById":1,"supersedesDecisionId":1,"reason":{"category":"road_reports","text":"County reports the highway closed."}}'` (`201`, `"id":2`), then `RUN_ID=<id> $V api directives-superseded POST /api/decisions/1/directives '{"scope":{"kind":"facility"},"directive":"report","reason":{"category":"other","text":"Too late."},"issuedById":1}'`. `409 {"conflict":"newer_decision","latestDecisionId":2}`.
- **Verify tampered (simulated).** Last, and only on this throwaway instance: play someone who edits the database file past the add-only trigger with `sqlite3 "$DB_PATH" "drop trigger decision_directives_reject_update; update decision_directives set reason_text = 'Everyone stays home.' where id = 2"`. Run `RUN_ID=<id> $V api directives-verify-tampered GET /api/decisions/1/verify`. `200` with `{"decisionId":1,"intact":false,"breaks":[{"record":"directive","id":2,"reason":"content_altered"}]}`.

## Gotchas

- Steps build on each other, so start from a fresh `up` and keep the order. The superseded step adds decision `2`, and the tamper step drops a trigger, so both come last.
- `effectiveAt` must be exactly `toISOString` form (`…:00.000Z`). An offset such as `-05:00`, a missing `.000`, or a six-digit year is a `422`, not a conversion.
- A body that fails the schema is `422` before any lookup, so a missing reason wins over a superseded decision. Among the checks after lookup, the issuer comes first, then `effectiveAt`, then the scope, and the `409` last.
- Unknown keys anywhere in the body, including inside `scope` and `reason`, are dropped, the same as the decision routes. They are never stored or hashed.
- Nothing yet reads directives to change who is notified. That proof belongs to the notification package (#29).
