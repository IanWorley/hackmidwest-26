import { Effect, Option } from "effect";
import {
  type DecisionContent,
  type DecisionMaker,
  findChainTip,
  findDecider,
  insertDecision,
} from "./decision-store";
import type { Facility } from "./facilities";
import type { RecommendationRow } from "./recommendation-store";
import { parseInstant } from "./zoned-time";

function noDecisionContent(
  recommendation: RecommendationRow,
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

const recordNoDecision = Effect.fn("recordNoDecision")(function* (
  recommendation: RecommendationRow,
  backup: DecisionMaker,
  decidedAt: string,
) {
  yield* insertDecision(
    noDecisionContent(recommendation, backup, decidedAt),
    recommendation.decideBy,
  ).pipe(
    // A concurrent evaluation may record the missed deadline first; the chain triggers then reject this insert and its row stands.
    Effect.catchTag("DecisionStorageError", (error) =>
      Effect.flatMap(findChainTip(recommendation.id), (tip) => {
        if (Option.isNone(tip)) {
          return Effect.fail(error);
        }
        return Effect.void;
      }),
    ),
  );
});

const recordMissedDeadline = Effect.fn("recordMissedDeadline")(function* (
  facility: Facility,
  prior: Option.Option<RecommendationRow>,
  evaluatedAt: string,
) {
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
  yield* recordNoDecision(prior.value, backup.value, evaluatedAt);
});

export { recordMissedDeadline, recordNoDecision };
