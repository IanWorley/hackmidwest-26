import type { Recommendation } from "./notification-api";

type OpmStatus = Recommendation["snapshot"]["output"]["status"];
type Confidence = Recommendation["confidence"];
type Finding = Recommendation["snapshot"]["output"]["findings"][number];
type HazardWindow = Pick<Finding["timing"]["hazardWindow"], "start" | "end">;

/** Only the fields the diff reads, so a full record and a test fixture both fit. */
interface ComparedRecommendation {
  readonly id: number;
  readonly confidence: Confidence;
  readonly snapshot: {
    readonly output: {
      readonly facilityDate: string;
      /** The posture with its delay or release time, so a changed time counts as a change. */
      readonly status: OpmStatus;
      readonly findings: readonly {
        readonly timing: { readonly hazardWindow: HazardWindow };
      }[];
    };
  };
}

type RecommendationChange =
  | {
      readonly field: "posture";
      readonly from: OpmStatus;
      readonly to: OpmStatus;
    }
  | {
      readonly field: "confidence";
      readonly from: Confidence;
      readonly to: Confidence;
    }
  | {
      readonly field: "hazardWindow";
      readonly from: HazardWindow | null;
      readonly to: HazardWindow | null;
    };

/** The deciding finding comes first, so its window is the one the posture rests on. */
function hazardWindowOf(record: ComparedRecommendation): HazardWindow | null {
  const [deciding] = record.snapshot.output.findings;
  if (deciding === undefined) {
    return null;
  }
  const { start, end } = deciding.timing.hazardWindow;
  return { start, end };
}

function sameStatus(left: OpmStatus, right: OpmStatus): boolean {
  switch (left.posture) {
    case "delayed_arrival":
      return (
        right.posture === left.posture && right.delayHours === left.delayHours
      );
    case "early_dismissal":
      return right.posture === left.posture && right.departAt === left.departAt;
    default:
      return right.posture === left.posture;
  }
}

function sameWindow(
  left: HazardWindow | null,
  right: HazardWindow | null,
): boolean {
  return left?.start === right?.start && left?.end === right?.end;
}

function recommendationChanges(
  decided: ComparedRecommendation,
  latest: ComparedRecommendation,
): RecommendationChange[] {
  const changes: RecommendationChange[] = [];
  const fromStatus = decided.snapshot.output.status;
  const toStatus = latest.snapshot.output.status;
  if (!sameStatus(fromStatus, toStatus)) {
    changes.push({ field: "posture", from: fromStatus, to: toStatus });
  }
  if (decided.confidence !== latest.confidence) {
    changes.push({
      field: "confidence",
      from: decided.confidence,
      to: latest.confidence,
    });
  }
  const from = hazardWindowOf(decided);
  const to = hazardWindowOf(latest);
  if (!sameWindow(from, to)) {
    changes.push({ field: "hazardWindow", from, to });
  }
  return changes;
}

export type {
  ComparedRecommendation,
  Confidence,
  HazardWindow,
  RecommendationChange,
};
export { recommendationChanges };
