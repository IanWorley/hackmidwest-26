import type { ConfidenceLevel, Hazard } from "@hackmidwest/db";
import type { Caveat } from "./confidence";
import type { Crossing } from "./cutoff-checks";
import type { InputKind } from "./freshness";
import type { EndBasis } from "./hazard-window";
import type { IsoInstant } from "./samples";
import type { Cutoff } from "./thresholds";
import type { OpmStatus } from "./timing";
import { formatTimeOfDay, parseInstant } from "./zoned-time";

const HAZARD_LABELS: Readonly<Record<Hazard, string>> = {
  winter: "Winter weather",
  wind: "Wind",
  airQuality: "Air quality",
};

const INPUT_LABELS: Readonly<Record<InputKind, string>> = {
  observations: "The NWS observation",
  forecast: "The NWS forecast",
  airQuality: "The air quality reading",
};

const END_BASIS_LABELS: Readonly<Record<Exclude<EndBasis, "ends">, string>> = {
  expires: "the alert's expiry time",
  forecast: "forecast hours or a single reading",
};

interface RationaleFacts {
  readonly status: OpmStatus;
  readonly facilityDate: string;
  readonly crossings: readonly Crossing[];
  readonly driver: Crossing | undefined;
  readonly confidence: ConfidenceLevel;
  readonly caveats: readonly Caveat[];
  readonly decideBy: IsoInstant;
  readonly now: IsoInstant;
  readonly zone: string;
}

function rationale(facts: RationaleFacts): string {
  return [
    `Recommend ${describeStatus(facts.status)} for ${facts.facilityDate}.`,
    ...crossingSentences(facts.crossings, facts.driver),
    confidenceSentence(facts.confidence, facts.caveats),
    deadlineSentence(facts.decideBy, facts.now, facts.zone),
  ].join(" ");
}

function crossingSentences(
  crossings: readonly Crossing[],
  driver: Crossing | undefined,
): string[] {
  if (crossings.length === 0) {
    return ["No hazard crossed a cutoff."];
  }
  return crossings.map((crossing) => {
    const { hazard, cutoff, threshold, outcome } = crossing;
    const unit = unitLabel(threshold.unit);
    const { status } = outcome.timing;
    const sentence = `${HAZARD_LABELS[hazard]} reached ${outcome.observed} ${unit} against the ${threshold.value} ${unit} ${cutoff} cutoff (${signed(outcome.margin)}), per ${threshold.source}. Timed against the facility day, it calls for ${describeStatus(status)}.`;
    if (crossing === driver && status.posture !== "normal") {
      return `${sentence} This drives the recommendation.`;
    }
    return sentence;
  });
}

function confidenceSentence(
  confidence: ConfidenceLevel,
  caveats: readonly Caveat[],
): string {
  if (caveats.length === 0) {
    return `Confidence is ${confidence}.`;
  }
  return `Confidence is ${confidence}: ${caveats.map(describeCaveat).join("; ")}.`;
}

function deadlineSentence(
  decideBy: IsoInstant,
  now: IsoInstant,
  zone: string,
): string {
  const deadline = `Decide by ${formatTimeOfDay(parseInstant(decideBy), zone)} local time`;
  if (parseInstant(now) > parseInstant(decideBy)) {
    return `${deadline}; that deadline has passed.`;
  }
  return `${deadline}.`;
}

function describeStatus(status: OpmStatus): string {
  switch (status.posture) {
    case "normal":
      return "normal operations";
    case "delayed_arrival":
      return `a ${status.delayHours}-hour delayed arrival`;
    case "early_dismissal":
      return `early dismissal at ${status.departAtLocal}`;
    case "unscheduled_telework":
      return "unscheduled telework";
    case "full_closure":
      return "full closure";
    default:
      return status satisfies never;
  }
}

function describeCaveat(caveat: Caveat): string {
  switch (caveat.kind) {
    case "staleInput":
      return `${INPUT_LABELS[caveat.input]} is ${caveat.ageMinutes} minutes old against a ${caveat.limitMinutes}-minute limit`;
    case "missingReading":
      return `no reading reached the ${HAZARD_LABELS[caveat.hazard].toLowerCase()} ${caveat.cutoff} cutoff`;
    case "estimatedEnd":
      return `the hazard's end comes from ${END_BASIS_LABELS[caveat.endBasis]}`;
    default:
      return caveat satisfies never;
  }
}

function unitLabel(unit: Cutoff["unit"]): string {
  switch (unit) {
    case "nws_severity":
      return "severity";
    case "mph":
      return "mph";
    case "aqi":
      return "AQI";
    default:
      return unit satisfies never;
  }
}

function signed(margin: number): string {
  if (margin >= 0) {
    return `+${margin}`;
  }
  return String(margin);
}

export { describeStatus, rationale };
