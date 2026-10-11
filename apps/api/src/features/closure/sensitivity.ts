import type { Crossing } from "./cutoff-checks";
import { mostDisruptive, sameStatus } from "./disruption";
import type { HazardEvidence } from "./hazard-window";
import { describeStatus } from "./rationale";
import type { IsoInstant, Period } from "./samples";
import { TIMING_POLICY } from "./thresholds";
import {
  evaluateTiming,
  type FacilitySchedule,
  type OpmStatus,
} from "./timing";
import { shiftIso } from "./zoned-time";

const MINUTES_PER_HOUR = 60;
const SHIFT = TIMING_POLICY.sensitivityShiftMinutes.value;
const SHIFTS = [
  { shiftMinutes: -SHIFT, direction: "earlier" },
  { shiftMinutes: SHIFT, direction: "later" },
] as const;

interface Sensitivity {
  readonly shiftMinutes: number;
  readonly status: OpmStatus;
  readonly statement: string;
}

interface SensitivityContext {
  readonly now: IsoInstant;
  readonly facility: FacilitySchedule;
}

function sensitivityOf(
  crossings: readonly Crossing[],
  status: OpmStatus,
  context: SensitivityContext,
): Sensitivity[] {
  return SHIFTS.flatMap(({ shiftMinutes, direction }) => {
    const shifted =
      mostDisruptive(
        crossings.map(
          ({ hazard, threshold, outcome }) =>
            evaluateTiming({
              ...context,
              hazard,
              crossedPosture: threshold.posture,
              evidence: shiftEvidence(outcome.evidence, shiftMinutes),
            }).status,
        ),
        (candidate) => candidate,
      ) ?? ({ posture: "normal" } satisfies OpmStatus);
    if (sameStatus(shifted, status)) {
      return [];
    }
    const hours = Math.abs(shiftMinutes) / MINUTES_PER_HOUR;
    return [
      {
        shiftMinutes,
        status: shifted,
        statement: `If the hazard window moves ${hours} hours ${direction}, this becomes ${describeStatus(shifted)} instead of ${describeStatus(status)}.`,
      },
    ];
  });
}

function shiftEvidence(
  evidence: HazardEvidence,
  minutes: number,
): HazardEvidence {
  function shiftPeriod({ startTime, endTime }: Period): Period {
    return {
      startTime: shiftIso(startTime, minutes),
      endTime: shiftIso(endTime, minutes),
    };
  }
  if (evidence.source === "forecast") {
    const [head, ...tail] = evidence.exceedingPeriods;
    return {
      source: "forecast",
      exceedingPeriods: [shiftPeriod(head), ...tail.map(shiftPeriod)],
    };
  }
  return {
    source: "alert",
    window: {
      ...evidence.window,
      start: shiftIso(evidence.window.start, minutes),
      end: shiftIso(evidence.window.end, minutes),
    },
    exceedingPeriods: evidence.exceedingPeriods.map(shiftPeriod),
  };
}

export type { Sensitivity };
export { sensitivityOf };
