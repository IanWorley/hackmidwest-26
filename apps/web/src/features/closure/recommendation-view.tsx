import type { JSX } from "react";
import { Badge } from "@/components/ui/badge";
import type { Posture, Recommendation } from "./decision-api";
import { HAZARD_LABELS } from "./facility-fields";
import { formatFacilityTime } from "./format-time";
import { POSTURE_CLASSES, POSTURE_LABELS } from "./labels";

type Output = Recommendation["snapshot"]["output"];
type Caveat = Output["caveats"][number];
type Check = Output["hazards"][number]["checks"][number];
type CrossedOutcome = Extract<Check["outcome"], { kind: "crossed" }>;
type CutoffName = Check["cutoff"];
type ThresholdUnit = Check["threshold"]["unit"];
type InputKind = Output["inputs"][number]["kind"];
type Confidence = Output["confidence"];

const CONFIDENCE_LABEL = "Confidence";
const RATIONALE_HEADING = "Rationale";
const THRESHOLDS_HEADING = "Thresholds crossed";
const NO_THRESHOLDS_TEXT = "No threshold was crossed.";
const CAVEATS_HEADING = "Caveats";
const INPUTS_HEADING = "Inputs";
const SENSITIVITY_HEADING = "Sensitivity";
const NEXT_DAY_LABEL = "Next operating day affected";
const LIVE_LABEL = "Live evaluation";
const AS_OF_LABEL = "As-of evaluation";
const EVALUATED_LABEL = "evaluated";
const DATA_AS_OF_LABEL = "data as of";
const RELEASE_LABEL = "Release at";
const RELEASE_PASSED_TEXT = "release time has passed";
const DELAY_UNIT = "hour delay";

const CONFIDENCE_LABELS: Record<Confidence, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

const CUTOFF_LABELS: Record<CutoffName, string> = {
  stormWarning: "Storm warning",
  advisory: "Advisory",
  sustained: "Sustained wind",
  gust: "Wind gust",
  unhealthy: "Unhealthy air",
  veryUnhealthy: "Very unhealthy air",
};

const UNIT_SUFFIXES: Record<ThresholdUnit, string> = {
  mph: " mph",
  aqi: " AQI",
  nws_severity: "",
};

const INPUT_KIND_LABELS: Record<InputKind, string> = {
  observations: "Observation",
  forecast: "Forecast",
  airQuality: "Air quality",
  alert: "Alert",
};

export function PostureBadge({ posture }: { posture: Posture }): JSX.Element {
  return (
    <Badge className={POSTURE_CLASSES[posture]}>
      {POSTURE_LABELS[posture]}
    </Badge>
  );
}

function StatusDetail({
  status,
  now,
}: {
  status: Output["status"];
  now: number;
}): JSX.Element | null {
  switch (status.posture) {
    case "delayed_arrival":
      return <p>{`${status.delayHours} ${DELAY_UNIT}`}</p>;
    case "early_dismissal": {
      const passed = Date.parse(status.departAt) <= now;
      return (
        <p>
          {`${RELEASE_LABEL} ${status.departAtLocal}`}
          {passed && <strong>{` (${RELEASE_PASSED_TEXT})`}</strong>}
        </p>
      );
    }
    default:
      return null;
  }
}

function caveatText(caveat: Caveat): string {
  switch (caveat.kind) {
    case "staleInput":
      return `${INPUT_KIND_LABELS[caveat.input]} data is ${caveat.ageMinutes} min old; the limit is ${caveat.limitMinutes} min.`;
    case "missingReading":
      return `No ${CUTOFF_LABELS[caveat.cutoff].toLowerCase()} reading for ${HAZARD_LABELS[caveat.hazard].toLowerCase()}.`;
    case "estimatedEnd":
      return `The hazard's end time is estimated from the ${caveat.endBasis === "expires" ? "alert's expiry" : "forecast"}.`;
    default:
      return caveat satisfies never;
  }
}

function crossedText(check: Check, outcome: CrossedOutcome): string {
  const suffix = UNIT_SUFFIXES[check.threshold.unit];
  return `Observed ${outcome.observed}${suffix} against a ${check.threshold.value}${suffix} cutoff (margin ${outcome.margin}). ${check.threshold.citation}`;
}

function CrossedThresholds({ output }: { output: Output }): JSX.Element {
  const crossed = output.hazards.flatMap((assessment) =>
    assessment.checks.flatMap((check) =>
      check.outcome.kind === "crossed"
        ? [{ hazard: assessment.hazard, check, outcome: check.outcome }]
        : [],
    ),
  );
  if (crossed.length === 0) {
    return <p>{NO_THRESHOLDS_TEXT}</p>;
  }
  return (
    <ul className="list-disc space-y-1 pl-5">
      {crossed.map(({ hazard, check, outcome }) => (
        <li key={`${hazard}-${check.cutoff}`}>
          <span className="font-medium">{`${HAZARD_LABELS[hazard]}, ${CUTOFF_LABELS[check.cutoff]}: `}</span>
          {crossedText(check, outcome)}
        </li>
      ))}
    </ul>
  );
}

function EvaluationLabel({
  recommendation,
  timeZone,
}: {
  recommendation: Recommendation;
  timeZone: string;
}): JSX.Element {
  const evaluatedAt = formatFacilityTime(recommendation.evaluatedAt, timeZone);
  if (recommendation.mode === "live") {
    return (
      <p className="text-muted-foreground">{`${LIVE_LABEL}, ${evaluatedAt}`}</p>
    );
  }
  return (
    <p className="font-medium">
      {`${AS_OF_LABEL}: ${DATA_AS_OF_LABEL} ${formatFacilityTime(recommendation.asOf, timeZone)}, ${EVALUATED_LABEL} ${evaluatedAt}`}
    </p>
  );
}

function Section({
  heading,
  children,
}: {
  heading: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <section className="space-y-1">
      <h3 className="font-medium">{heading}</h3>
      {children}
    </section>
  );
}

export function RecommendationView({
  recommendation,
  timeZone,
  now,
}: {
  recommendation: Recommendation;
  timeZone: string;
  now: number;
}): JSX.Element {
  const { output } = recommendation.snapshot;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <PostureBadge posture={recommendation.posture} />
        <span>{`${CONFIDENCE_LABEL}: ${CONFIDENCE_LABELS[output.confidence]}`}</span>
      </div>
      <StatusDetail now={now} status={output.status} />
      <EvaluationLabel recommendation={recommendation} timeZone={timeZone} />
      <Section heading={RATIONALE_HEADING}>
        <p>{output.rationale}</p>
      </Section>
      <Section heading={THRESHOLDS_HEADING}>
        <CrossedThresholds output={output} />
      </Section>
      {output.caveats.length > 0 && (
        <Section heading={CAVEATS_HEADING}>
          <ul className="list-disc pl-5">
            {output.caveats.map((caveat) => (
              <li key={caveatText(caveat)}>{caveatText(caveat)}</li>
            ))}
          </ul>
        </Section>
      )}
      <Section heading={INPUTS_HEADING}>
        <ul className="list-disc pl-5">
          {output.inputs.map((input) => (
            <li key={`${input.kind}-${input.ref}`}>
              {`${INPUT_KIND_LABELS[input.kind]} from ${input.source} (${input.ref}), as of ${formatFacilityTime(input.asOf, timeZone)}`}
            </li>
          ))}
        </ul>
      </Section>
      {output.sensitivity.length > 0 && (
        <Section heading={SENSITIVITY_HEADING}>
          <ul className="list-disc pl-5">
            {output.sensitivity.map((shift) => (
              <li key={shift.shiftMinutes}>{shift.statement}</li>
            ))}
          </ul>
        </Section>
      )}
      {output.nextDay !== null && (
        <p>{`${NEXT_DAY_LABEL}: ${output.nextDay}`}</p>
      )}
    </div>
  );
}
