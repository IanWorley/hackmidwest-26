# Decisions

A named decision maker accepts, overrides, or defers a facility's recommendation. `POST /api/recommendations/:id/decisions` stores the choice as an add-only `decisions` row that copies the recommendation's id and content hash, so the record shows what the person saw and what they chose. A change to a decision is a new row that supersedes the current one. The route refuses a decision on a recommendation that a newer one has replaced, and a change that does not name the current decision, with a `409` that says which row is current. `GET /api/facilities/:id/decisions` lists the facility's decisions with their human inputs, and `GET /api/decisions/:id/verify` recomputes every hash on the decision's chain and reports each link. When an evaluation runs after a recommendation's `decideBy` and nobody decided, the evaluation first records a `no_decision` row naming the facility's backup decision maker.

## Sub-features

- `decisions-accept` returns `201` with `action` `accept`, `chosenPosture` equal to the recommendation's `posture`, `recommendationHash` equal to its `contentHash`, `decidedByName` and `decidedByRole` copied from `decision_makers`, `identityVerified: false`, the human inputs with `reportedAt` defaulted to `decidedAt`, `decideBy`, and `minutesBeforeDecideBy`.
- `decisions-override` returns `201` with the requested `chosenPosture` and the reason category and text.
- `decisions-defer` returns `201` with `chosenPosture: null` and `recheckAt` in `toISOString` form.
- `decisions-supersede` stores a change as a new row whose `supersedesDecisionId` is the decision it replaces.
- `decisions-invalid` returns `422 {"message":"Invalid decision","field":"<path>"}` for an override or defer without a reason, a change without a reason, a re-check outside the window between now and `decideBy`, an override to the recommended posture, a blank reason or human input, a field the action does not take (such as `posture` on an accept), or a decider who is not a `decision_makers` row.
- `decisions-stale-recommendation` returns `409` with `"conflict":"newer_recommendation"` and `latestRecommendationId`.
- `decisions-changed` returns `409` with `"conflict":"decision_changed"` and `latestDecisionId` when `supersedesDecisionId` is missing or not the newest decision.
- `decisions-history` returns the facility's decisions newest first, each with its `humanInputs`, and `404 {"message":"Facility not found"}` for an unknown facility.
- `decisions-verify` returns `{"decisionId","ok","links"}` with one link per recommendation, decision, and dispatch on the chain, and `404 {"message":"Decision not found"}` for an unknown id. A failing link lists its `faults`: `content_hash_mismatch`, `parent_hash_mismatch`, `missing_parent`, or `missing_predecessor` when the decision it supersedes is gone from the chain.
- `decisions-no-dispatch` stores no `notification_dispatches` row when a decision is recorded.
- `decisions-missed-deadline` records `no_decision` on the prior recommendation, decided by the facility's backup, when an evaluation runs after its `decideBy` with no decision.
- `decisions-add-only` rejects an `UPDATE` of a stored decision.

## How to get to it (user POV)

- Send `POST /api/recommendations/<id>/decisions` to `$API_URL` with a body whose `action` is `accept`, `override`, or `defer`. The decision screen's Accept, Override, and Defer buttons will call this.
- Send `GET /api/facilities/<id>/decisions`.
- Send `GET /api/decisions/<id>/verify`.
- Send `POST /api/facilities/<id>/recommendations` after the latest recommendation's `decideBy` has passed.

## Driving it with verify.sh

Preconditions:

- Baseline state from the index, then one evaluation: `RUN_ID=<id> $V api decisions-evaluate POST /api/facilities/1/recommendations`. Note its `posture` and `decideBy`. Recommendation `1` must have a `decideBy` in the future.
- Pick `<other>`, a posture other than the recommended one, and `<recheck>`, an instant between now and `decideBy`.

- **Accept.** Run `RUN_ID=<id> $V api decisions-accept POST /api/recommendations/1/decisions '{"action":"accept","decidedById":1,"humanInputs":[{"reportedBy":"Night shift supervisor","text":"The north lot has not been plowed."}]}'`. `201`; `"id":1`, `"chosenPosture"` equals the recommendation's posture, `"decidedByName":"Dana Whitfield"`, `"identityVerified":false`, one human input with `reportedAt` equal to `decidedAt`.
- **Override.** Run `RUN_ID=<id> $V api decisions-override POST /api/recommendations/1/decisions '{"action":"override","posture":"<other>","reason":{"category":"road_reports","text":"County reports ice on Route 9."},"supersedesDecisionId":1,"decidedById":1}'`. `201`; `"id":2`, `"chosenPosture":"<other>"`, `"supersedesDecisionId":1`.
- **Defer.** Run `RUN_ID=<id> $V api decisions-defer POST /api/recommendations/1/decisions '{"action":"defer","recheckAt":"<recheck>","reason":{"category":"local_conditions","text":"Waiting on the plow report."},"supersedesDecisionId":2,"decidedById":1}'`. `201`; `"id":3`, `"chosenPosture":null`, `recheckAt` is `<recheck>` with `.000Z`.
- **Reason required.** Run `RUN_ID=<id> $V api decisions-override-no-reason POST /api/recommendations/1/decisions '{"action":"override","posture":"full_closure","supersedesDecisionId":3,"decidedById":1}'` and the same for `defer` as `decisions-defer-no-reason`. Each `422 {"message":"Invalid decision","field":"reason"}`.
- **Re-check window.** Run `RUN_ID=<id> $V api decisions-defer-after-decide-by POST /api/recommendations/1/decisions '{"action":"defer","recheckAt":"<an hour after decideBy>","reason":{"category":"other","text":"Later."},"supersedesDecisionId":3,"decidedById":1}'`. `422` with `"field":"recheckAt"`.
- **Unknown field.** Run `RUN_ID=<id> $V api decisions-extra-field POST /api/recommendations/1/decisions '{"action":"accept","posture":"<other>","reason":{"category":"other","text":"Back to the recommendation."},"supersedesDecisionId":3,"decidedById":1}'`. `422` with `"field":"posture"`.
- **Unknown decider.** Run `RUN_ID=<id> $V api decisions-unknown-decider POST /api/recommendations/1/decisions '{"action":"accept","reason":{"category":"other","text":"Back to the recommendation."},"supersedesDecisionId":3,"decidedById":999}'`. `422` with `"field":"decidedById"`.
- **Decision changed.** Run `RUN_ID=<id> $V api decisions-changed-conflict POST /api/recommendations/1/decisions '{"action":"accept","decidedById":1}'`. `409 {"conflict":"decision_changed",…,"latestDecisionId":3}`.
- **History.** Run `RUN_ID=<id> $V api decisions-history GET /api/facilities/1/decisions`. `200`; ids `3`, `2`, `1` in that order; decision `1` carries the human input. `GET /api/facilities/999/decisions` answers `404 {"message":"Facility not found"}`.
- **Verify.** Run `RUN_ID=<id> $V api decisions-verify GET /api/decisions/1/verify`. `200 {"decisionId":1,"ok":true,"links":[…]}` with links `recommendation 1`, `decision 1`, `decision 2`, `decision 3`, each `"ok":true`. `GET /api/decisions/999/verify` answers `404 {"message":"Decision not found"}`.
- **Stale recommendation.** Run `RUN_ID=<id> $V api decisions-reevaluate POST /api/facilities/1/recommendations` (`201`, id `2`), then `RUN_ID=<id> $V api decisions-stale-recommendation POST /api/recommendations/1/decisions '{"action":"accept","reason":{"category":"other","text":"Back to the recommendation."},"supersedesDecisionId":3,"decidedById":1}'`. `409 {"conflict":"newer_recommendation",…,"latestRecommendationId":2}`.
- **Stored rows.** Run `RUN_ID=<id> $V db decisions-rows "select id, recommendation_id, action, chosen_posture, decided_by_id, decided_by_name, decided_at, identity_verified, reason_category, recheck_at, supersedes_decision_id, recommendation_hash = (select content_hash from recommendations r where r.id = recommendation_id) as hash_matches from decisions order by id"`. Rows `1`, `2`, `3` match the responses; `identity_verified` is `0` and `hash_matches` is `1` on each. Run `RUN_ID=<id> $V db decisions-human-inputs "select id, decision_id, reported_by, reported_at, text from human_inputs order by id"` for the one input on decision `1`.
- **No dispatch.** Run `RUN_ID=<id> $V db decisions-no-dispatch "select count(*) as dispatches from notification_dispatches"`. `0`.
- **Add-only.** Run `RUN_ID=<id> $V db-reject decisions-update "update decisions set reason_text = 'Edited later.' where id = 2" "decisions is add-only: record a superseding decision instead of updating one"`. `verdict> rejected`.

## Gotchas

- Recommendations are live, so the recommended posture and `decideBy` change between runs. Choose `<other>` and `<recheck>` from the evaluation you just made.
- `decisions-missed-deadline` needs the clock to pass a recommendation's `decideBy`, which is usually hours away, and `asOf` does not move that clock. Leave an undecided instance running past `decideBy` and evaluate again, or report it as not driven and point to `missed-deadline.test.ts`.
- `422` from the decision route always has the `{"message","field"}` shape, including for a malformed `:id`, where `field` is `id`.
- Every change after the first decision must name the newest decision in `supersedesDecisionId` and carry a reason, even an accept.
- Decisions stay in the database after `POST` like recommendations do. Start from a fresh `up` so the ids hold.
