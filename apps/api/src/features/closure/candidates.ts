import type { NwsAlert } from "../../clients/nws-model";
import type { HazardEvidence, Period } from "./hazard-window";
import { byText, firstBy } from "./order";
import {
  contiguousRuns,
  type InputRef,
  type Sample,
  type SampleSources,
  samplesFor,
} from "./samples";
import {
  type AlertCutoff,
  type Cutoff,
  type GaugeCutoff,
  NWS_SEVERITIES,
  type NwsSeverity,
} from "./thresholds";
import { MS_PER_MINUTE, parseInstant } from "./zoned-time";

const TENTHS = 10;
const NO_MINIMUM_DURATION_MINUTES = 0;

interface Measurement {
  readonly observed: number | NwsSeverity;
  readonly margin: number;
  readonly input: InputRef;
}

type UntimedCrossing = { readonly evidence: HazardEvidence } & Measurement;

/** This engine takes no NWPS gauge stages as input, so it checks every cutoff but the river-stage ones. */
type EngineCutoff = Exclude<Cutoff, GaugeCutoff>;

/** Each crossing is a separate hazard window; `peak` is reported when none crosses. */
interface Candidates {
  readonly crossings: readonly UntimedCrossing[];
  readonly peak: Measurement | undefined;
}

interface CandidateSources extends SampleSources {
  readonly alertsInForce: readonly NwsAlert[];
}

function candidates(
  threshold: EngineCutoff,
  context: CandidateSources,
): Candidates {
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

function severityRank(severity: NwsSeverity): number {
  return NWS_SEVERITIES.indexOf(severity);
}

function durationMinutes(period: Period): number {
  return (
    (parseInstant(period.endTime) - parseInstant(period.startTime)) /
    MS_PER_MINUTE
  );
}

export type { EngineCutoff, Measurement, UntimedCrossing };
export { byMargin, candidates };
