import type { Hazard } from "@hackmidwest/db";
import type { NwsAlert } from "../../clients/nws-model";
import {
  byMargin,
  candidates,
  type Measurement,
  type UntimedCrossing,
} from "./candidates";
import { type CutoffName, isCutoffName } from "./cutoff-names";
import { byDisruption, mostDisruptive } from "./disruption";
import { firstBy } from "./order";
import type { Posture } from "./postures";
import type { SampleSources } from "./samples";
import { type Cutoff, THRESHOLDS } from "./thresholds";
import {
  evaluateTiming,
  type FacilitySchedule,
  type TimingResult,
} from "./timing";
import { parseInstant } from "./zoned-time";

type Crossed = {
  readonly kind: "crossed";
  readonly timing: TimingResult;
} & UntimedCrossing;

type CheckOutcome =
  | { readonly kind: "absent" }
  | ({ readonly kind: "below" } & Measurement)
  | Crossed;

interface CutoffCheck {
  readonly cutoff: CutoffName;
  readonly threshold: Cutoff;
  readonly outcome: CheckOutcome;
  /** `YYYY-MM-DD` when any window of this cutoff starts after the facility day, even one `outcome` did not keep. */
  readonly nextDay: string | null;
}

interface HazardAssessment {
  readonly hazard: Hazard;
  readonly posture: Posture;
  readonly checks: readonly CutoffCheck[];
}

interface CheckContext extends SampleSources {
  readonly facility: FacilitySchedule;
  readonly alertsInForce: readonly NwsAlert[];
}

interface Crossing {
  readonly hazard: Hazard;
  readonly cutoff: CutoffName;
  readonly threshold: Cutoff;
  readonly outcome: Crossed;
}

function assessHazard(hazard: Hazard, context: CheckContext): HazardAssessment {
  const cutoffs: Readonly<Record<string, Cutoff>> = THRESHOLDS[hazard].cutoffs;
  const checks = Object.entries(cutoffs).flatMap(
    ([cutoff, threshold]): CutoffCheck[] => {
      if (!isCutoffName(hazard, cutoff)) {
        return [];
      }
      return [
        { cutoff, threshold, ...assessCutoff(hazard, threshold, context) },
      ];
    },
  );
  const strongest = mostDisruptive(
    crossingsOf(hazard, checks),
    ({ outcome }) => outcome.timing.status,
  );
  return {
    hazard,
    posture: strongest?.outcome.timing.status.posture ?? "normal",
    checks,
  };
}

function crossings(hazards: readonly HazardAssessment[]): Crossing[] {
  return hazards.flatMap(({ hazard, checks }) => crossingsOf(hazard, checks));
}

function crossingsOf(
  hazard: Hazard,
  checks: readonly CutoffCheck[],
): Crossing[] {
  return checks.flatMap(({ cutoff, threshold, outcome }) => {
    if (outcome.kind !== "crossed") {
      return [];
    }
    return [{ hazard, cutoff, threshold, outcome }];
  });
}

/** Times every crossing and keeps the strongest, so input order never decides the outcome. */
function assessCutoff(
  hazard: Hazard,
  threshold: Cutoff,
  context: CheckContext,
): Pick<CutoffCheck, "outcome" | "nextDay"> {
  const { crossings: untimed, peak } = candidates(threshold, context);
  const timed = untimed.map(
    (crossing): Crossed => ({
      kind: "crossed",
      ...crossing,
      timing: evaluateTiming({
        now: context.now,
        facility: context.facility,
        hazard,
        crossedPosture: threshold.posture,
        evidence: crossing.evidence,
      }),
    }),
  );
  return {
    outcome: firstBy(timed, byStrongest) ?? belowOrAbsent(peak),
    nextDay: nextDayOf(timed),
  };
}

function belowOrAbsent(peak: Measurement | undefined): CheckOutcome {
  if (peak === undefined) {
    return { kind: "absent" };
  }
  return { kind: "below", ...peak };
}

function nextDayOf(timed: readonly Crossed[]): string | null {
  for (const { timing } of timed) {
    if (timing.timingCase.kind === "startsAfterHours") {
      return timing.timingCase.nextDay;
    }
  }
  return null;
}

/** Runs from one forecast share a ref, so the earlier window breaks a remaining tie. */
function byStrongest(left: Crossed, right: Crossed): number {
  return (
    byDisruption(left.timing.status, right.timing.status) ||
    byMargin(left, right) ||
    parseInstant(left.timing.hazardWindow.start) -
      parseInstant(right.timing.hazardWindow.start)
  );
}

export type {
  CheckContext,
  CheckOutcome,
  Crossing,
  CutoffCheck,
  HazardAssessment,
};
export { assessHazard, crossings };
