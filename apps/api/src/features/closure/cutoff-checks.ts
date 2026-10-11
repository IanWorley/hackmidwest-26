import type { Hazard } from "@hackmidwest/db";
import type { NwsAlert } from "../../clients/nws-model";
import { byDisruption, mostDisruptive } from "./disruption";
import type { HazardEvidence } from "./hazard-window";
import { byText, firstBy } from "./order";
import type { Posture } from "./postures";
import {
  contiguousRuns,
  type InputRef,
  type Period,
  type Sample,
  type SampleSources,
  samplesFor,
} from "./samples";
import {
  type AlertCutoff,
  type Cutoff,
  type HazardThresholds,
  NWS_SEVERITIES,
  type NwsSeverity,
  THRESHOLDS,
} from "./thresholds";
import {
  evaluateTiming,
  type FacilitySchedule,
  type TimingResult,
} from "./timing";
import { MS_PER_MINUTE, parseInstant } from "./zoned-time";

const TENTHS = 10;
const NO_MINIMUM_DURATION_MINUTES = 0;

interface Measurement {
  readonly observed: number | NwsSeverity;
  readonly margin: number;
  readonly input: InputRef;
}

type Crossed = {
  readonly kind: "crossed";
  readonly evidence: HazardEvidence;
  readonly timing: TimingResult;
} & Measurement;

type CheckOutcome =
  | { readonly kind: "absent" }
  | ({ readonly kind: "below" } & Measurement)
  | Crossed;

type UntimedCrossing = Omit<Crossed, "kind" | "timing">;

/** Each crossing is a separate hazard window; `peak` is reported when none crosses. */
interface Candidates {
  readonly crossings: readonly UntimedCrossing[];
  readonly peak: Measurement | undefined;
}

interface CutoffCheck {
  readonly cutoff: string;
  readonly threshold: Cutoff;
  readonly outcome: CheckOutcome;
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
  readonly cutoff: string;
  readonly threshold: Cutoff;
  readonly outcome: Crossed;
}

function assessHazard(hazard: Hazard, context: CheckContext): HazardAssessment {
  const cutoffs: HazardThresholds["cutoffs"] = THRESHOLDS[hazard].cutoffs;
  const checks = Object.entries(cutoffs).map(
    ([cutoff, threshold]): CutoffCheck => ({
      cutoff,
      threshold,
      outcome: assessCutoff(hazard, threshold, context),
    }),
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
): CheckOutcome {
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
  const strongest = firstBy(timed, byStrongest);
  if (strongest !== undefined) {
    return strongest;
  }
  if (peak === undefined) {
    return { kind: "absent" };
  }
  return { kind: "below", ...peak };
}

function candidates(threshold: Cutoff, context: CheckContext): Candidates {
  switch (threshold.unit) {
    case "nws_severity":
      return severityCandidates(threshold, context.alertsInForce);
    case "mph":
      return numericCandidates(
        threshold.value,
        threshold.minDurationMinutes,
        samplesFor(threshold.metric, context),
      );
    case "aqi":
      return numericCandidates(
        threshold.value,
        NO_MINIMUM_DURATION_MINUTES,
        samplesFor("aqi", context),
      );
    default:
      return threshold satisfies never;
  }
}

function severityCandidates(
  threshold: AlertCutoff,
  alertsInForce: readonly NwsAlert[],
): Candidates {
  const measured = alertsInForce
    .filter((alert) => threshold.events.includes(alert.event))
    .map((alert) => ({
      alert,
      measurement: {
        observed: alert.severity,
        margin: severityRank(alert.severity) - severityRank(threshold.value),
        input: {
          kind: "alert",
          source: "nws",
          ref: alert.id,
          asOf: alert.hazardWindow.start,
        },
      } satisfies Measurement,
    }));
  return {
    crossings: measured
      .filter(({ measurement }) => measurement.margin >= 0)
      .map(({ alert, measurement }) => ({
        ...measurement,
        evidence: {
          source: "alert",
          window: alert.hazardWindow,
          exceedingPeriods: [],
        },
      })),
    peak: highest(measured.map(({ measurement }) => measurement)),
  };
}

function numericCandidates(
  cutoffValue: number,
  minDurationMinutes: number,
  samples: readonly Sample[],
): Candidates {
  const cutoffTenths = cutoffValue * TENTHS;
  const measured = samples
    .filter((sample) => durationMinutes(sample.period) >= minDurationMinutes)
    .map((sample) => ({
      period: sample.period,
      measurement: reportedMeasurement(sample, cutoffTenths),
    }));
  const crossingRuns = contiguousRuns(
    measured.filter(({ measurement }) => measurement.margin >= 0),
  );
  return {
    crossings: crossingRuns.flatMap(([first, ...rest]) => {
      const peak = highest([first, ...rest].map((run) => run.measurement));
      if (peak === undefined) {
        return [];
      }
      return [
        {
          ...peak,
          evidence: {
            source: "forecast",
            exceedingPeriods: [first.period, ...rest.map((run) => run.period)],
          },
        },
      ];
    }),
    peak: highest(measured.map(({ measurement }) => measurement)),
  };
}

/** Compared at the reported tenth, so a record never shows a margin that disagrees with its crossing. */
function reportedMeasurement(
  sample: Sample,
  cutoffTenths: number,
): Measurement {
  const tenths = Math.round(sample.value * TENTHS);
  return {
    observed: tenths / TENTHS,
    margin: (tenths - cutoffTenths) / TENTHS,
    input: sample.input,
  };
}

function highest(
  measurements: readonly Measurement[],
): Measurement | undefined {
  return firstBy(measurements, byMargin);
}

/** Largest margin first, then by input ref, so equal alerts resolve the same way in any order. */
function byMargin(left: Measurement, right: Measurement): number {
  return right.margin - left.margin || byText(left.input.ref, right.input.ref);
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

function severityRank(severity: NwsSeverity): number {
  return NWS_SEVERITIES.indexOf(severity);
}

function durationMinutes(period: Period): number {
  return (
    (parseInstant(period.endTime) - parseInstant(period.startTime)) /
    MS_PER_MINUTE
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
