import { HAZARDS, type Hazard } from "@hackmidwest/db";
import type { FloodCategory } from "../../clients/nwps";
import type { HazardEvidence } from "./hazard-window";
import { type NonEmpty, type Origin, periodOf, type Signal } from "./signals";
import {
  type Cutoff,
  NWS_SEVERITIES,
  type NwsSeverity,
  THRESHOLDS,
  type WindMetric,
} from "./thresholds";
import { MS_PER_MINUTE, parseInstant } from "./zoned-time";

type AlertOrigin = Extract<Origin, { readonly source: "alerts" }>;

/** NWPS reports stages in hundredths of a foot, so a stage difference rounds there. */
const STAGE_DECIMALS = 2;

/** How far a signal is past a cutoff. For an alert, `by` counts CAP severity steps. */
type Margin =
  | {
      readonly unit: "nws_severity";
      readonly event: string;
      readonly observed: NwsSeverity;
      readonly cutoff: NwsSeverity;
      readonly by: number;
    }
  | {
      readonly unit: "mph";
      readonly metric: WindMetric;
      readonly observed: number;
      readonly cutoff: number;
      readonly by: number;
    }
  | {
      readonly unit: "aqi";
      readonly observed: number;
      readonly cutoff: number;
      readonly by: number;
    }
  /** `observed` is the river's crest and `cutoff` this gauge's stage for `category`, in feet. */
  | {
      readonly unit: "nws_flood_category";
      readonly category: FloodCategory;
      readonly observed: number;
      readonly cutoff: number;
      readonly by: number;
    };

interface Exceedance {
  readonly hazard: Hazard;
  /** Key in `THRESHOLDS[hazard].cutoffs`. */
  readonly cutoffId: string;
  /** Copied whole, citation included, so a stored snapshot shows the threshold it was judged by. */
  readonly cutoff: Cutoff;
  /** The largest margin among `signals`; the first signal wins a tie. */
  readonly margin: Margin;
  readonly signals: NonEmpty<Signal>;
}

interface Crossing {
  readonly signal: Signal;
  readonly margin: Margin;
}

/** A reading is a single instant, so it never counts toward a cutoff's minimum duration. */
const MEASURES_DURATION = {
  alerts: true,
  forecast: true,
  gauge: true,
  observations: false,
  airQuality: false,
} as const satisfies Record<Origin["source"], boolean>;

/** One exceedance per crossed cutoff, in `HAZARDS` order then each hazard's cutoff key order. */
function matchCutoffs(
  hazards: readonly Hazard[],
  signals: readonly Signal[],
): Exceedance[] {
  return HAZARDS.filter((hazard) => hazards.includes(hazard)).flatMap(
    (hazard) => {
      const cutoffs: Readonly<Record<string, Cutoff>> =
        THRESHOLDS[hazard].cutoffs;
      return Object.entries(cutoffs).flatMap(([cutoffId, cutoff]) =>
        exceedance(hazard, cutoffId, cutoff, signals),
      );
    },
  );
}

function exceedance(
  hazard: Hazard,
  cutoffId: string,
  cutoff: Cutoff,
  signals: readonly Signal[],
): Exceedance[] {
  const crossings = signals.flatMap((signal): Crossing[] => {
    const margin = marginOver(signal, cutoff);
    if (margin === null) {
      return [];
    }
    return [{ signal, margin }];
  });
  const [first, ...rest] = crossings;
  if (first === undefined || !lastsLongEnough(crossings, cutoff)) {
    return [];
  }
  return [
    {
      hazard,
      cutoffId,
      cutoff,
      margin: rest.reduce(largerMargin, first).margin,
      signals: [first.signal, ...rest.map((crossing) => crossing.signal)],
    },
  ];
}

function largerMargin(best: Crossing, crossing: Crossing): Crossing {
  if (crossing.margin.by > best.margin.by) {
    return crossing;
  }
  return best;
}

/** `null` when the signal measures another quantity or falls short of the cutoff. */
function marginOver(signal: Signal, cutoff: Cutoff): Margin | null {
  switch (cutoff.unit) {
    case "nws_severity":
      if (
        signal.unit !== "nws_severity" ||
        !cutoff.events.includes(signal.event)
      ) {
        return null;
      }
      return atOrPast({
        unit: "nws_severity",
        event: signal.event,
        observed: signal.value,
        cutoff: cutoff.value,
        by:
          NWS_SEVERITIES.indexOf(signal.value) -
          NWS_SEVERITIES.indexOf(cutoff.value),
      });
    case "mph":
      if (signal.unit !== "mph" || signal.metric !== cutoff.metric) {
        return null;
      }
      return atOrPast({
        unit: "mph",
        metric: signal.metric,
        observed: signal.value,
        cutoff: cutoff.value,
        by: signal.value - cutoff.value,
      });
    case "aqi":
      if (signal.unit !== "aqi") {
        return null;
      }
      return atOrPast({
        unit: "aqi",
        observed: signal.value,
        cutoff: cutoff.value,
        by: signal.value - cutoff.value,
      });
    // Each category has its own stage, so a crossing counts only for its own category.
    case "nws_flood_category":
      if (
        signal.unit !== "nws_flood_category" ||
        signal.value !== cutoff.value
      ) {
        return null;
      }
      return atOrPast({
        unit: "nws_flood_category",
        category: signal.value,
        observed: signal.stageFt,
        cutoff: signal.floodStageFt,
        by: Number(
          (signal.stageFt - signal.floodStageFt).toFixed(STAGE_DECIMALS),
        ),
      });
    default:
      return cutoff satisfies never;
  }
}

function atOrPast(margin: Margin): Margin | null {
  if (margin.by >= 0) {
    return margin;
  }
  return null;
}

function lastsLongEnough(
  crossings: readonly Crossing[],
  cutoff: Cutoff,
): boolean {
  if (!("minDurationMinutes" in cutoff)) {
    return true;
  }
  const measured = crossings
    .map(({ signal }) => signal.origin)
    .filter((origin) => MEASURES_DURATION[origin.source]);
  return longestRunMinutes(measured) >= cutoff.minDurationMinutes;
}

function longestRunMinutes(origins: readonly Origin[]): number {
  const spans = origins
    .map(periodOf)
    .map(({ startTime, endTime }) => ({
      start: parseInstant(startTime),
      end: parseInstant(endTime),
    }))
    .sort((a, b) => a.start - b.start);
  let longest = 0;
  let run: { readonly start: number; readonly end: number } | null = null;
  for (const span of spans) {
    if (run === null || span.start > run.end) {
      run = span;
    } else {
      run = { start: run.start, end: Math.max(run.end, span.end) };
    }
    longest = Math.max(longest, run.end - run.start);
  }
  return longest / MS_PER_MINUTE;
}

/**
 * The latest-ending alert is the window and every other signal extends it as a period; with no
 * alert, every signal is a period. `hazardInterval` takes the union either way.
 */
function toEvidence(signals: NonEmpty<Signal>): HazardEvidence {
  const window = latestAlert(signals);
  if (window === null) {
    const [head, ...tail] = signals;
    return {
      source: "forecast",
      exceedingPeriods: [
        periodOf(head.origin),
        ...tail.map((signal) => periodOf(signal.origin)),
      ],
    };
  }
  return {
    source: "alert",
    window: { start: window.start, end: window.end, endBasis: window.endBasis },
    exceedingPeriods: signals
      .filter((signal) => signal.origin !== window)
      .map((signal) => periodOf(signal.origin)),
  };
}

function latestAlert(signals: readonly Signal[]): AlertOrigin | null {
  let latest: AlertOrigin | null = null;
  for (const { origin } of signals) {
    if (
      origin.source === "alerts" &&
      (latest === null || parseInstant(origin.end) > parseInstant(latest.end))
    ) {
      latest = origin;
    }
  }
  return latest;
}

export type { Exceedance, Margin };
export { matchCutoffs, toEvidence };
