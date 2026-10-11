import type { JSX, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { Posture, Recommendation } from "./decision-api";
import { formatFacilityTime } from "./format-time";
import { HAZARD_LABELS, POSTURE_CLASSES, POSTURE_LABELS } from "./labels";
import {
  confidenceReasonText,
  inputLabel,
  marginText,
  type Output,
  sensitivityText,
  statusText,
} from "./recommendation-text";

type Confidence = Output["confidence"]["level"];

const CONFIDENCE_LABEL = "Confidence";
const RATIONALE_HEADING = "Rationale";
const FINDINGS_HEADING = "Thresholds crossed";
const NO_FINDINGS_TEXT = "No threshold was crossed.";
const CONFIDENCE_HEADING = "Why confidence is not higher";
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
const LEADS_TO = "leads to";
const AS_OF = "as of";

const CONFIDENCE_LABELS: Record<Confidence, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

function PostureBadge({ posture }: { posture: Posture }): JSX.Element {
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
    case "early_dismissal":
      return (
        <p>
          {`${RELEASE_LABEL} ${status.departAtLocal}`}
          {Date.parse(status.departAt) <= now && (
            <strong>{` (${RELEASE_PASSED_TEXT})`}</strong>
          )}
        </p>
      );
    default:
      return null;
  }
}

function Findings({ output }: { output: Output }): JSX.Element {
  if (output.findings.length === 0) {
    return <p>{NO_FINDINGS_TEXT}</p>;
  }
  return (
    <ul className="list-disc space-y-1 pl-5">
      {output.findings.map((finding) => (
        <li key={`${finding.hazard}-${finding.cutoffId}`}>
          <span className="font-medium">{`${HAZARD_LABELS[finding.hazard]}: `}</span>
          {`${marginText(finding.margin)}, ${LEADS_TO} ${statusText(finding.timing.status)}. `}
          <span className="text-muted-foreground text-sm">
            {finding.cutoff.citation}
          </span>
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
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="space-y-1">
      <h3 className="font-medium">{heading}</h3>
      {children}
    </section>
  );
}

/** Lines may repeat, so each key counts how many times its text came before. */
function keyedLines(
  items: readonly string[],
): { readonly key: string; readonly text: string }[] {
  const seen = new Map<string, number>();
  return items.map((text) => {
    const count = seen.get(text) ?? 0;
    seen.set(text, count + 1);
    return { key: `${text}#${count}`, text };
  });
}

function TextList({ items }: { items: readonly string[] }): JSX.Element {
  return (
    <ul className="list-disc pl-5">
      {keyedLines(items).map(({ key, text }) => (
        <li key={key}>{text}</li>
      ))}
    </ul>
  );
}

function inputLines(
  recommendation: Recommendation,
  timeZone: string,
): string[] {
  return recommendation.timeline.flatMap((entry) => {
    if (entry.event !== "input") {
      return [];
    }
    return [
      `${inputLabel(entry.input)}, ${AS_OF} ${formatFacilityTime(entry.at, timeZone)}`,
    ];
  });
}

function RecommendationView({
  recommendation,
  timeZone,
  now,
}: {
  recommendation: Recommendation;
  timeZone: string;
  now: number;
}): JSX.Element {
  const { output } = recommendation.snapshot;
  const reasons = output.confidence.reasons.map(confidenceReasonText);
  const sensitivity = output.sensitivity.map(sensitivityText);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <PostureBadge posture={recommendation.posture} />
        <span>{`${CONFIDENCE_LABEL}: ${CONFIDENCE_LABELS[output.confidence.level]}`}</span>
      </div>
      <StatusDetail now={now} status={output.status} />
      <EvaluationLabel recommendation={recommendation} timeZone={timeZone} />
      <Section heading={RATIONALE_HEADING}>
        <p>{output.rationale}</p>
      </Section>
      <Section heading={FINDINGS_HEADING}>
        <Findings output={output} />
      </Section>
      {reasons.length > 0 && (
        <Section heading={CONFIDENCE_HEADING}>
          <TextList items={reasons} />
        </Section>
      )}
      <Section heading={INPUTS_HEADING}>
        <TextList items={inputLines(recommendation, timeZone)} />
      </Section>
      {sensitivity.length > 0 && (
        <Section heading={SENSITIVITY_HEADING}>
          <TextList items={sensitivity} />
        </Section>
      )}
      {output.nextDay !== null && (
        <p>{`${NEXT_DAY_LABEL}: ${output.nextDay}`}</p>
      )}
    </div>
  );
}

export { PostureBadge, RecommendationView };
