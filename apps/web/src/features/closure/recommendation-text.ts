import type { Recommendation } from "./decision-api";
import { HAZARD_LABELS, POSTURE_LABELS, WIND_METRIC_LABELS } from "./labels";

type Output = Recommendation["snapshot"]["output"];
type OpmStatus = Output["status"];
type Margin = Output["findings"][number]["margin"];
type ConfidenceReason = Output["confidence"]["reasons"][number];
type Sensitivity = Output["sensitivity"][number];
type EndBasis = Extract<ConfidenceReason, { kind: "endBasis" }>["endBasis"];
type InputKind = Extract<ConfidenceReason, { kind: "missing" }>["input"];
type TimelineInput = Extract<
  Recommendation["timeline"][number],
  { event: "input" }
>["input"];

const MINUTES_PER_HOUR = 60;

const INPUT_LABELS: Record<TimelineInput, string> = {
  alerts: "NWS alerts",
  observations: "NWS observations",
  forecast: "NWS hourly forecast",
  airQuality: "Open-Meteo air quality",
  gauge: "NWS river gauge",
};

const END_BASIS_TEXT: Record<EndBasis, string> = {
  ends: "The hazard's end comes from the alert's stated end time.",
  expires: "The hazard's end is estimated from the alert's expiry.",
  forecast: "The hazard's end is estimated from the forecast.",
  reading: "The hazard's end is estimated from a single reading.",
};

function statusText(status: OpmStatus): string {
  switch (status.posture) {
    case "delayed_arrival":
      return `${POSTURE_LABELS[status.posture]}, ${status.delayHours} h`;
    case "early_dismissal":
      return `${POSTURE_LABELS[status.posture]} at ${status.departAtLocal}`;
    default:
      return POSTURE_LABELS[status.posture];
  }
}

function inputLabel(input: TimelineInput | InputKind): string {
  return INPUT_LABELS[input];
}

function marginText(margin: Margin): string {
  switch (margin.unit) {
    case "nws_severity":
      return `${margin.event}: ${margin.observed} severity against a ${margin.cutoff} cutoff`;
    case "mph":
      return `${WIND_METRIC_LABELS[margin.metric]} ${margin.observed} mph against a ${margin.cutoff} mph cutoff (over by ${margin.by})`;
    case "aqi":
      return `AQI ${margin.observed} against a ${margin.cutoff} cutoff (over by ${margin.by})`;
    case "nws_flood_category":
      return `River crest ${margin.observed} ft against the ${margin.cutoff} ft ${margin.category} flood stage (over by ${margin.by} ft)`;
    default:
      return margin satisfies never;
  }
}

function confidenceReasonText(reason: ConfidenceReason): string {
  switch (reason.kind) {
    case "endBasis":
      return END_BASIS_TEXT[reason.endBasis];
    case "stale":
      return `${inputLabel(reason.input)} data is ${reason.ageMinutes} min old; the limit is ${reason.limitMinutes} min.`;
    case "missing":
      return `No ${inputLabel(reason.input)} data was available.`;
    default:
      return reason satisfies never;
  }
}

function sensitivityText(sensitivity: Sensitivity): string {
  switch (sensitivity.kind) {
    case "onsetShift": {
      const hours = Math.abs(sensitivity.shiftMinutes) / MINUTES_PER_HOUR;
      let direction = "later";
      if (sensitivity.shiftMinutes < 0) {
        direction = "earlier";
      }
      return `If onset moves ${hours} h ${direction}: ${statusText(sensitivity.status)}.`;
    }
    case "withoutFinding":
      return `Without the ${HAZARD_LABELS[sensitivity.hazard].toLowerCase()} crossing (${marginText(sensitivity.margin)}): ${statusText(sensitivity.status)}.`;
    default:
      return sensitivity satisfies never;
  }
}

export type { Output, TimelineInput };
export {
  confidenceReasonText,
  inputLabel,
  marginText,
  sensitivityText,
  statusText,
};
