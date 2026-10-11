import type { Recommendation } from "./notification-api";

type Posture = Recommendation["posture"];
type Confidence = Recommendation["confidence"];
type Finding = Recommendation["snapshot"]["output"]["findings"][number];
type HazardWindow = Pick<Finding["timing"]["hazardWindow"], "start" | "end">;

/** Only the fields the diff reads, so a full record and a test fixture both fit. */
interface ComparedRecommendation {
  readonly id: number;
  readonly posture: Posture;
  readonly confidence: Confidence;
  readonly snapshot: {
    readonly output: {
      readonly facilityDate: string;
      readonly findings: readonly {
        readonly timing: { readonly hazardWindow: HazardWindow };
      }[];
    };
  };
}

type RecommendationChange =
  | { readonly field: "posture"; readonly from: Posture; readonly to: Posture }
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
  if (decided.posture !== latest.posture) {
    changes.push({
      field: "posture",
      from: decided.posture,
      to: latest.posture,
    });
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
