import type { FloodCategory } from "../../clients/nwps";
import type { ForecastPeriod, NwsAlert } from "../../clients/nws-model";
import type { EngineInput } from "./engine-input";
import type { InputKind } from "./freshness";
import { gaugeSignals } from "./gauge-stages";
import { currentAlerts, type HazardEvidence } from "./hazard-window";
import type { Reading } from "./readings";
import type { NwsSeverity, WindMetric } from "./thresholds";
import { TIMING_POLICY } from "./timing-policy";
import {
  type IsoInstant,
  MS_PER_MINUTE,
  parseInstant,
  toInstant,
  toIso,
} from "./zoned-time";

const KMH_PER_MPH = 1.609_344;
/** "15 mph" or "10 to 20 mph". Anything else ("Calm", null) yields no signal. */
const FORECAST_WIND_PATTERN = /^(?<low>\d+)(?: to (?<high>\d+))? mph$/u;

type NonEmpty<T> = readonly [T, ...T[]];
type Period = HazardEvidence["exceedingPeriods"][number];
type ReadingInput = Extract<InputKind, "observations" | "airQuality">;

/** One value in a cutoff's unit. Mirrors the `Cutoff` union so one switch narrows both. */
type Quantity =
  | {
      readonly unit: "nws_severity";
      readonly event: string;
      readonly value: NwsSeverity;
    }
  | {
      readonly unit: "mph";
      readonly metric: WindMetric;
      readonly value: number;
    }
  | { readonly unit: "aqi"; readonly value: number }
  | {
      readonly unit: "nws_flood_category";
      readonly value: FloodCategory;
      /** The crest while the river is at or above `floodStageFt`. */
      readonly stageFt: number;
      readonly floodStageFt: number;
    };

type Origin =
  | {
      readonly source: "alerts";
      /** The alert id. */
      readonly ref: string;
      /** When the alerts were fetched. */
      readonly asOf: IsoInstant;
      readonly start: IsoInstant;
      readonly end: IsoInstant;
      readonly endBasis: NwsAlert["hazardWindow"]["endBasis"];
    }
  | {
      /** A gauge spans its crossing, from the first stage at or above the flood stage. */
      readonly source: "forecast" | "gauge";
      readonly ref: string;
      readonly asOf: IsoInstant;
      readonly start: IsoInstant;
      readonly end: IsoInstant;
    }
  | {
      readonly source: ReadingInput;
      readonly ref: string;
      /** When the reading was observed. */
      readonly asOf: IsoInstant;
      /** A reading proves a crossing at `asOf`; it is treated as current until here. */
      readonly holdsUntil: IsoInstant;
    };

type Signal = Quantity & { readonly origin: Origin };

interface SignalInputs {
  readonly now: IsoInstant;
  readonly alerts: {
    readonly asOf: IsoInstant;
    readonly items: readonly NwsAlert[];
  };
  readonly readings: readonly Reading[];
  readonly forecast: {
    readonly asOf: IsoInstant;
    readonly rawRef: string;
    readonly periods: readonly ForecastPeriod[];
  } | null;
  readonly gauge: EngineInput["gauge"];
}

function normalize(inputs: SignalInputs): Signal[] {
  const { alerts, forecast } = inputs;
  return [
    ...currentAlerts(alerts.items).map((alert) =>
      alertSignal(alert, alerts.asOf),
    ),
    ...inputs.readings.flatMap(readingSignals),
    ...(forecast?.periods.flatMap((forecastPeriod) =>
      forecastSignals(forecastPeriod, forecast.rawRef, forecast.asOf),
    ) ?? []),
    ...gaugeSignals(inputs.gauge, inputs.now),
  ];
}

function alertSignal(alert: NwsAlert, asOf: IsoInstant): Signal {
  return {
    unit: "nws_severity",
    event: alert.event,
    value: alert.severity,
    origin: { source: "alerts", ref: alert.id, asOf, ...alert.hazardWindow },
  };
}

function readingSignals(reading: Reading): Signal[] {
  switch (reading.metric) {
    case "windSpeed":
      return windSignals(reading, "wind_sustained");
    case "windGust":
      return windSignals(reading, "wind_gust");
    case "aqi":
      return [
        {
          unit: "aqi",
          value: reading.value,
          origin: readingOrigin(
            reading,
            "airQuality",
            TIMING_POLICY.aqiReadingValidMinutes.value,
          ),
        },
      ];
    case "temperature":
    case "visibility":
      return [];
    default:
      return reading.metric satisfies never;
  }
}

/** The rounded mph is both compared and displayed, so "58 vs 58" never reads as uncrossed. */
function windSignals(reading: Reading, metric: WindMetric): Signal[] {
  if (reading.unit !== "km/h") {
    return [];
  }
  return [
    {
      unit: "mph",
      metric,
      value: Math.round(reading.value / KMH_PER_MPH),
      origin: readingOrigin(
        reading,
        "observations",
        TIMING_POLICY.observationValidMinutes.value,
      ),
    },
  ];
}

function readingOrigin(
  reading: Reading,
  source: ReadingInput,
  validMinutes: number,
): Origin {
  return {
    source,
    ref: reading.rawRef,
    asOf: reading.observedAt,
    holdsUntil: shiftIso(reading.observedAt, validMinutes),
  };
}

// A range takes its upper bound: the cutoff asks whether wind may reach the speed.
function forecastSignals(
  forecastPeriod: ForecastPeriod,
  ref: string,
  asOf: IsoInstant,
): Signal[] {
  const groups = FORECAST_WIND_PATTERN.exec(
    forecastPeriod.windSpeed ?? "",
  )?.groups;
  const upper = groups?.high ?? groups?.low;
  if (upper === undefined) {
    return [];
  }
  return [
    {
      unit: "mph",
      metric: "wind_sustained",
      value: Number(upper),
      origin: {
        source: "forecast",
        ref,
        asOf,
        start: forecastPeriod.startTime,
        end: forecastPeriod.endTime,
      },
    },
  ];
}

/** The span a signal stands for. A reading stands from when it was observed until it lapses. */
function periodOf(origin: Origin): Period {
  switch (origin.source) {
    case "alerts":
    case "forecast":
    case "gauge":
      return { startTime: origin.start, endTime: origin.end };
    case "observations":
    case "airQuality":
      return { startTime: origin.asOf, endTime: origin.holdsUntil };
    default:
      return origin satisfies never;
  }
}

/** Every signal moved by `minutes` (negative is earlier), for the onset what-if. */
function shiftSignals(
  signals: NonEmpty<Signal>,
  minutes: number,
): NonEmpty<Signal> {
  const [head, ...tail] = signals;
  function shift(signal: Signal): Signal {
    return { ...signal, origin: shiftOrigin(signal.origin, minutes) };
  }
  return [shift(head), ...tail.map(shift)];
}

function shiftOrigin(origin: Origin, minutes: number): Origin {
  switch (origin.source) {
    case "alerts":
    case "forecast":
    case "gauge":
      return {
        ...origin,
        start: shiftIso(origin.start, minutes),
        end: shiftIso(origin.end, minutes),
      };
    case "observations":
    case "airQuality":
      return {
        ...origin,
        asOf: shiftIso(origin.asOf, minutes),
        holdsUntil: shiftIso(origin.holdsUntil, minutes),
      };
    default:
      return origin satisfies never;
  }
}

function shiftIso(iso: IsoInstant, minutes: number): IsoInstant {
  return toIso(toInstant(parseInstant(iso) + minutes * MS_PER_MINUTE));
}

export type { NonEmpty, Origin, Signal, SignalInputs };
export { normalize, periodOf, shiftSignals };
