# Decisions

A named decision maker accepts, overrides, or defers a recommendation through `POST /api/recommendations/:id/decisions`. Each decision is a new row linked to the recommendation by id and content hash. A changed decision supersedes the newest one and needs a reason. `GET /api/facilities/:id/decisions` lists a facility's decisions newest first, and `GET /api/decisions/:id/verify` recomputes every hash in the decision's chain and reports whether it is intact, naming each record where a path first breaks. There is no web page for decisions yet.

## Sub-features

- `decisions-accept` records an `accept` with the recommended posture, `identityVerified: false`, and the decider's name and role.
- `decisions-unknown-field` answers `422` naming the unknown key, at the top level or nested in `reason` or a human input, and writes nothing.
- `decisions-reason-required` answers `422` naming `/reason` when an override or defer has no reason, or when a changed decision has none.
- `decisions-override` records a different posture; the same posture as the recommendation is `422` naming `/chosenPosture`.
- `decisions-defer` records a `recheckAt` strictly after the decision and strictly before the recommendation's `decideBy`; any other time is `422` naming `/recheckAt`.
- `decisions-human-input-time` answers `422` naming `/humanInputs/<index>/reportedAt` when a human input is reported after the decision.
- `decisions-supersede` requires `supersedesDecisionId` to name the newest decision on the recommendation, and answers `409 {"conflict":"newer_decision","latestDecisionId":<id>}` otherwise.
- `decisions-eligible-decider` answers `422` naming `/decidedById` unless the decider is the facility's decision maker or its backup.
- `decisions-stale-recommendation` answers `409 {"conflict":"newer_recommendation","latestRecommendationId":<id>}` once the facility has a newer recommendation.
- `decisions-history` lists a facility's decisions newest first, each with its human inputs and whole `minutesBeforeDecideBy` (negative once decideBy has passed).
- `decisions-verify` reports `intact: true` for an untouched chain and `intact: false` with the broken record when a recommendation's stored hash does not match its content.
- `decisions-verify-missing-predecessor` reports `intact: false` with a `missing_predecessor` break on a decision whose superseded decision was deleted behind the add-only trigger.
- `decisions-no-dispatch` records a decision without writing any `notification_dispatches` row.
- `decisions-not-found` answers `404` for an unknown recommendation, facility, or decision.

## How to get to it (user POV)

- `POST /api/recommendations/:id/decisions` with a JSON body whose `action` is `accept`, `override`, or `defer`.
- `GET /api/facilities/:id/decisions`.
- `GET /api/decisions/:id/verify`.
- Recommendations come from `POST /api/facilities/:id/recommendations`, which also writes the missed-deadline `no_decision` row. Both are verified in [recommendations](./recommendations.md), not here.

## Driving it with verify.sh

Preconditions:

- Baseline state from the index on a fresh `up`, so the recommendation and decision ids below start at `1`.
- Staging exception: a deferral must recheck before `decideBy`, and a live evaluation's `decideBy` is that morning's deadline, so the recipe inserts recommendations with a far-future `decideBy` using `sqlite3` against the instance's own `DB_PATH`. It and the missing-predecessor tamper at the end are the only direct writes, and each is recorded by the `db` read that follows it. Define the helpers in the same shell command as the steps that use them. `rec` prints the canonical JSON of a recommendation (sorted keys, every column except `id` and `content_hash`), so its SHA-256 is the content hash the API recomputes:

  ```sh
  source /tmp/verify-hackmidwest/runs/<id>/state.env
  DECIDE_BY=2099-10-02T11:00:00.000Z
  rec() { printf '{"asOf":"2026-10-02T09:55:00.000Z","confidence":"medium","decideBy":"%s","evaluatedAt":"%s","facilityId":%s,"posture":"delayed_arrival","snapshot":{}}' "$DECIDE_BY" "$1" "$2"; }
  stage() { sqlite3 "$DB_PATH" "insert into recommendations (facility_id, evaluated_at, as_of, posture, confidence, decide_by, snapshot, content_hash) values ($2, '$1', '2026-10-02T09:55:00.000Z', 'delayed_arrival', 'medium', '$DECIDE_BY', '{}', '$3')"; }
  REASON='"reason":{"category":"road_reports","text":"County reports the highway closed."}'
  ```

- **Stage a recommendation.** Run `stage 2026-10-02T10:00:00.000Z 1 "$(rec 2026-10-02T10:00:00.000Z 1 | sha256sum | cut -c1-64)"`, then `RUN_ID=<id> $V db decisions-staged-recommendation "select id, facility_id, posture, decide_by, content_hash from recommendations order by id"`. One row `1|1|delayed_arrival|2099-10-02T11:00:00.000Z|f63defaecf61533e0c7898e6b417df3b5e5f1dd180cdccee1ed72392eaa25583`.
- **Accept.** Run `RUN_ID=<id> $V api decisions-accept POST /api/recommendations/1/decisions '{"action":"accept","decidedById":1}'`. `201` with `"id":1`, `"action":"accept"`, `"chosenPosture":"delayed_arrival"`, `"recommendationHash":"f63defae…5583"`, `"decidedByName":"Dana Whitfield"`, `"identityVerified":false`, `"supersedesDecisionId":null`, and a positive `minutesBeforeDecideBy`.
- **Reason required.** Run `RUN_ID=<id> $V api decisions-override-no-reason POST /api/recommendations/1/decisions '{"action":"override","chosenPosture":"full_closure","decidedById":1,"supersedesDecisionId":1}'`. `422` with body `{"type":"validation","on":"body","property":"/reason","message":"Expected required property"}`.
- **Unknown field.** Run `RUN_ID=<id> $V api decisions-unknown-field POST /api/recommendations/1/decisions '{"action":"accept","decidedById":1,"supersedesDecisionId":1,"posture":"full_closure"}'`. `422` with body `{"type":"validation","on":"body","property":"/posture","message":"Unexpected property"}`.
- **Unknown nested field.** Run `RUN_ID=<id> $V api decisions-unknown-nested-field POST /api/recommendations/1/decisions '{"action":"override","chosenPosture":"full_closure","decidedById":1,"supersedesDecisionId":1,"reason":{"category":"road_reports","text":"County reports the highway closed.","severity":"high"}}'`. `422` with body `{"type":"validation","on":"body","property":"/reason/severity","message":"Unexpected property"}`.
- **Stale decision.** Override without naming decision 1. Run `RUN_ID=<id> $V api decisions-stale-decision POST /api/recommendations/1/decisions "{\"action\":\"override\",\"chosenPosture\":\"full_closure\",\"decidedById\":1,$REASON}"`. `409` with body `{"conflict":"newer_decision","latestDecisionId":1}`.
- **Override with a human input.** Run `RUN_ID=<id> $V api decisions-override POST /api/recommendations/1/decisions "{\"action\":\"override\",\"chosenPosture\":\"full_closure\",\"decidedById\":1,\"supersedesDecisionId\":1,$REASON,\"humanInputs\":[{\"reportedBy\":\"Night shift supervisor\",\"reportedAt\":\"2026-10-02T10:35:00.000Z\",\"text\":\"The north lot has not been plowed.\"}]}"`. `201` with `"id":2`, `"chosenPosture":"full_closure"`, `"supersedesDecisionId":1`, and one entry in `humanInputs` with `"decisionId":2`.
- **Defer too late.** Run `RUN_ID=<id> $V api decisions-defer-late POST /api/recommendations/1/decisions "{\"action\":\"defer\",\"recheckAt\":\"2099-10-02T11:00:00.000Z\",\"decidedById\":1,\"supersedesDecisionId\":2,$REASON}"`. `422` with `"property":"/recheckAt"` and `"message":"A deferral must recheck after the decision and before the recommendation's decideBy"`.
- **Defer to a time already past.** Run the same request with `"recheckAt":"2026-10-02T10:45:00.000Z"` as `decisions-defer-past`. `422` with the same property and message.
- **Human input reported after the decision.** Run `RUN_ID=<id> $V api decisions-late-human-input POST /api/recommendations/1/decisions "{\"action\":\"accept\",\"decidedById\":1,\"supersedesDecisionId\":2,$REASON,\"humanInputs\":[{\"reportedBy\":\"Road crew\",\"reportedAt\":\"2099-10-02T10:00:00.000Z\",\"text\":\"Highway reopened.\"}]}"`. `422` with `"property":"/humanInputs/0/reportedAt"` and `"message":"A human input cannot be reported after the decision"`.
- **Override to the recommended posture.** Run `RUN_ID=<id> $V api decisions-override-same-posture POST /api/recommendations/1/decisions "{\"action\":\"override\",\"chosenPosture\":\"delayed_arrival\",\"decidedById\":1,\"supersedesDecisionId\":2,$REASON}"`. `422` with `"property":"/chosenPosture"` and `"message":"An override must choose a posture other than the recommended one"`.
- **Ineligible decider.** Grace Lindqvist (id `5`) decides for Fargo, not Kansas City. Run `RUN_ID=<id> $V api decisions-ineligible-decider POST /api/recommendations/1/decisions "{\"action\":\"accept\",\"decidedById\":5,\"supersedesDecisionId\":2,$REASON}"`. `422` with `"property":"/decidedById"` and `"message":"Only the facility's decision maker or its backup can decide"`.
- **Defer.** Run the defer request with `"recheckAt":"2099-10-02T10:45:00.000Z"` as `decisions-defer`. `201` with `"id":3`, `"action":"defer"`, `"chosenPosture":null`, `"recheckAt":"2099-10-02T10:45:00.000Z"`, `"supersedesDecisionId":2`.
- **History.** Run `RUN_ID=<id> $V api decisions-history GET /api/facilities/1/decisions`. `200` with ids `3`, `2`, `1` in that order; only decision `2` has a human input.
- **Verify intact.** Run `RUN_ID=<id> $V api decisions-verify GET /api/decisions/3/verify`. `200` with `{"decisionId":3,"intact":true,"breaks":[]}`.
- **Stale recommendation.** Stage a newer recommendation for the same facility with `stage 2026-10-02T10:05:00.000Z 1 "$(rec 2026-10-02T10:05:00.000Z 1 | sha256sum | cut -c1-64)"`. Run `RUN_ID=<id> $V api decisions-stale-recommendation POST /api/recommendations/1/decisions "{\"action\":\"override\",\"chosenPosture\":\"full_closure\",\"decidedById\":1,\"supersedesDecisionId\":3,$REASON}"`. `409` with body `{"conflict":"newer_recommendation","latestRecommendationId":2}`.
- **Verify tampered.** Stage a recommendation for facility 2 whose stored hash is facility 1's: `stage 2026-10-02T10:00:00.000Z 2 "$(rec 2026-10-02T10:00:00.000Z 1 | sha256sum | cut -c1-64)"`. Accept it with `RUN_ID=<id> $V api decisions-tampered-accept POST /api/recommendations/3/decisions '{"action":"accept","decidedById":5}'` (Grace Lindqvist decides for Fargo) (`201`, `"id":4`; the database only checks that the decision copies the stored hash). Run `RUN_ID=<id> $V api decisions-verify-tampered GET /api/decisions/4/verify`. `200` with `{"decisionId":4,"intact":false,"breaks":[{"record":"recommendation","id":3,"reason":"content_altered"}]}`.
- **Not found.** Run `RUN_ID=<id> $V api decisions-unknown-recommendation POST /api/recommendations/999/decisions '{"action":"accept","decidedById":1}'`, `RUN_ID=<id> $V api decisions-history-unknown-facility GET /api/facilities/999/decisions`, and `RUN_ID=<id> $V api decisions-verify-unknown GET /api/decisions/999/verify`. Each is `404` with `{"message":"Recommendation not found"}`, `{"message":"Facility not found"}`, and `{"message":"Decision not found"}`.
- **Stored state.** Run `RUN_ID=<id> $V db decisions-rows "select id, recommendation_id, recommendation_hash = (select content_hash from recommendations r where r.id = recommendation_id) as hash_matches, action, chosen_posture, recheck_at, reason_category, supersedes_decision_id, identity_verified from decisions order by id"`. Rows `1|1|1|accept|delayed_arrival||||0`, `2|1|1|override|full_closure||road_reports|1|0`, `3|1|1|defer||2099-10-02T10:45:00.000Z|road_reports|2|0`, `4|3|1|accept|delayed_arrival||||0`.
- **No dispatch.** Run `RUN_ID=<id> $V db decisions-no-dispatches "select count(*) as dispatches from notification_dispatches"`. `0`.
- **Verify a missing predecessor.** This is the last step, because it breaks the add-only guarantee on purpose. Delete decision 1, which decision 2 supersedes, behind the trigger: `sqlite3 "$DB_PATH" "drop trigger decisions_reject_delete; delete from decisions where id = 1"` (the `sqlite3` shell leaves foreign keys off). Run `RUN_ID=<id> $V db decisions-predecessor-deleted "select id, supersedes_decision_id from decisions where recommendation_id = 1 order by id"`. Rows `2|1` and `3|2`. Run `RUN_ID=<id> $V api decisions-verify-missing-predecessor GET /api/decisions/3/verify`. `200` with `{"decisionId":3,"intact":false,"breaks":[{"record":"decision","id":2,"reason":"missing_predecessor"}]}`.

## Gotchas

- Steps build on each other: ids, `supersedesDecisionId`, and the `409`s depend on the order above. Start from a fresh `up`.
- `decidedAt` is the API's clock, so `minutesBeforeDecideBy` depends on when you run the recipe. The staged `decideBy` is far in the future so a deferral can still land before it; assert the sign of `minutesBeforeDecideBy`, not its value.
- The staged `snapshot` is `{}`, and `rec` must print the same columns in sorted key order. Any other byte changes the hash, and verify then reports the staged recommendation as not intact.
- Unknown keys are refused at every depth. Elysia's default normalize would strip them silently, so the route checks the raw body in a `transform` first.
- A body that fails the schema is `422` before any lookup, so a missing reason wins over a stale `supersedesDecisionId`.
- Only the facility's decision maker or its backup may decide. Identity is not verified (`identityVerified` is always `false`).
