import type { EngineInput } from "./engine-input";
import { type InputKind, staleInputs } from "./freshness";
import type { Reading } from "./readings";
import type { ConfidenceReason } from "./recommendation";
import { type Cutoff, THRESHOLDS } from "./thresholds";
import { type IsoInstant, parseInstant } from "./zoned-time";

/** Stale or missing inputs among those the profiled hazards' cutoffs read. */
function inputHealth(input: EngineInput): ConfidenceReason[] {
  const required = new Set(
    input.facility.hazards.flatMap((hazard) =>
      Object.values<Cutoff>(THRESHOLDS[hazard].cutoffs).flatMap((cutoff) =>
        unitInputs(cutoff.unit, input),
      ),
    ),
  );
  const stamps: { readonly input: InputKind; readonly asOf: string }[] =
    input.readings.flatMap((reading) => {
      const kind = readingInput(reading.metric);
      if (kind === null) {
        return [];
      }
      return [{ input: kind, asOf: reading.observedAt }];
    });
  if (input.forecast !== null) {
    stamps.push({ input: "forecast", asOf: input.forecast.asOf });
  }
  const gaugeAsOf = gaugeStamp(input.gauge);
  if (gaugeAsOf !== null) {
    stamps.push({ input: "gauge", asOf: gaugeAsOf });
  }
  return [...required].flatMap((kind): ConfidenceReason[] => {
    const [latest] = stamps
      .filter((stamp) => stamp.input === kind)
      .sort((a, b) => parseInstant(b.asOf) - parseInstant(a.asOf));
    if (latest === undefined) {
      return [{ kind: "missing", input: kind }];
    }
    return staleInputs([latest], input.now).map((stale) => ({
      kind: "stale",
      ...stale,
    }));
  });
}

/** The inputs a cutoff unit is read from. Alerts are always present by type. */
function unitInputs(
  unit: Cutoff["unit"],
  input: EngineInput,
): readonly InputKind[] {
  switch (unit) {
    case "nws_severity":
      return [];
    case "mph":
      return ["observations", "forecast"];
    case "aqi":
      return ["airQuality"];
    // A facility with no gauge relies on flood alerts alone, so nothing is missing.
    case "nws_flood_category":
      if (input.gauge === null) {
        return [];
      }
      return ["gauge"];
    default:
      return unit satisfies never;
  }
}

// NWPS may return forecast stages with no current observation; then the fetch time dates the gauge.
function gaugeStamp(gauge: EngineInput["gauge"]): IsoInstant | null {
  if (gauge === null) {
    return null;
  }
  if (gauge.observed !== null) {
    return gauge.observed.validTime;
  }
  if (gauge.forecast.length > 0) {
    return gauge.asOf;
  }
  return null;
}

/** `null` for a metric no cutoff reads, so it cannot vouch for an input being present. */
function readingInput(metric: Reading["metric"]): InputKind | null {
  switch (metric) {
    case "windSpeed":
    case "windGust":
      return "observations";
    case "aqi":
      return "airQuality";
    case "temperature":
    case "visibility":
      return null;
    default:
      return metric satisfies never;
  }
}

export { inputHealth };
