import type { recommendations } from "@hackmidwest/db";
import { Effect, Option } from "effect";
import {
  type DecisionContent,
  type DecisionMaker,
  findChainTip,
  findDecider,
  insertDecision,
} from "./decision-store";
import type { Facility } from "./facilities";
import { latestRecommendationOf } from "./recommendation-store";
import { parseInstant } from "./zoned-time";

function noDecisionContent(
  recommendation: typeof recommendations.$inferSelect,
  backup: DecisionMaker,
  decidedAt: string,
): DecisionContent {
  return {
    recommendationId: recommendation.id,
    recommendationHash: recommendation.contentHash,
    facilityId: recommendation.facilityId,
    action: "no_decision",
    chosenPosture: null,
    decidedById: backup.id,
    decidedByName: backup.name,
    decidedByRole: backup.role,
    decidedAt,
    identityVerified: false,
    reasonCategory: null,
    reasonText: null,
    recheckAt: null,
    supersedesDecisionId: null,
    humanInputs: [],
  };
}

/** Before a newer recommendation replaces it, a facility's latest recommendation whose `decideBy` passed with no decision gets a `no_decision` row naming the facility's backup decision maker. */
const recordMissedDeadline = Effect.fn("recordMissedDeadline")(function* (
  facility: Facility,
  evaluatedAt: string,
) {
  const prior = yield* latestRecommendationOf(facility.id);
  if (
    Option.isNone(prior) ||
    parseInstant(prior.value.decideBy) >= parseInstant(evaluatedAt) ||
    Option.isSome(yield* findChainTip(prior.value.id))
  ) {
    return;
  }
  const backup = yield* findDecider(facility.backupDecisionMakerId);
  if (Option.isNone(backup)) {
    return yield* Effect.die("facility backup decision maker is missing");
  }
  yield* insertDecision(
    noDecisionContent(prior.value, backup.value, evaluatedAt),
    prior.value.decideBy,
  );
});

export { recordMissedDeadline };
