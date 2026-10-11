import {
  CONFIDENCE_LEVELS,
  type ConfidenceLevel,
  type Hazard,
} from "@hackmidwest/db";
import type { HazardAssessment } from "./cutoff-checks";
import type { CutoffName } from "./cutoff-names";
import { type StaleInput, staleInputs } from "./freshness";
import type { EndBasis } from "./hazard-window";
import type { InputRef } from "./samples";
import type { IsoInstant, TimingResult } from "./timing";

type Caveat =
  | ({ readonly kind: "staleInput" } & StaleInput)
  | {
      readonly kind: "missingReading";
      readonly hazard: Hazard;
      readonly cutoff: CutoffName;
    }
  | {
      readonly kind: "estimatedEnd";
      readonly endBasis: Exclude<EndBasis, "ends">;
    };

const CAVEAT_CONFIDENCE: Readonly<Record<Caveat["kind"], ConfidenceLevel>> = {
  staleInput: "low",
  missingReading: "low",
  estimatedEnd: "medium",
};

function caveatsFor(
  hazards: readonly HazardAssessment[],
  inputs: readonly InputRef[],
  driverTiming: TimingResult | undefined,
  now: IsoInstant,
): Caveat[] {
  return [
    ...staleCaveats(inputs, now),
    ...missingReadingCaveats(hazards),
    ...estimatedEndCaveats(driverTiming),
  ];
}

function staleCaveats(inputs: readonly InputRef[], now: IsoInstant): Caveat[] {
  const stamps = inputs.flatMap(({ kind, asOf }) => {
    if (kind === "alert") {
      return [];
    }
    return [{ input: kind, asOf }];
  });
  return staleInputs(stamps, now).map(
    (entry): Caveat => ({ kind: "staleInput", ...entry }),
  );
}

/** Only numeric cutoffs: no matching alert is a real answer, but no reading is a gap. */
function missingReadingCaveats(hazards: readonly HazardAssessment[]): Caveat[] {
  return hazards.flatMap(({ hazard, checks }) =>
    checks.flatMap(({ cutoff, threshold, outcome }): Caveat[] => {
      if (outcome.kind !== "absent" || threshold.unit === "nws_severity") {
        return [];
      }
      return [{ kind: "missingReading", hazard, cutoff }];
    }),
  );
}

function estimatedEndCaveats(driverTiming: TimingResult | undefined): Caveat[] {
  const endBasis = driverTiming?.hazardWindow.endBasis;
  if (endBasis === undefined || endBasis === "ends") {
    return [];
  }
  return [{ kind: "estimatedEnd", endBasis }];
}

function confidenceOf(caveats: readonly Caveat[]): ConfidenceLevel {
  return caveats.reduce<ConfidenceLevel>((level, { kind }) => {
    const capped = CAVEAT_CONFIDENCE[kind];
    if (CONFIDENCE_LEVELS.indexOf(capped) < CONFIDENCE_LEVELS.indexOf(level)) {
      return capped;
    }
    return level;
  }, "high");
}

export type { Caveat };
export { caveatsFor, confidenceOf };
