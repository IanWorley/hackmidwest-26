import type { JSX } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { facilityClock } from "./facility-clock";
import { POSTURE_LABELS } from "./posture-labels";
import {
  type ComparedRecommendation,
  type Confidence,
  type HazardWindow,
  type RecommendationChange,
  recommendationChanges,
} from "./recommendation-changes";

const TITLE = "A newer recommendation is available";
const UNCHANGED_TEXT =
  "Your decision is unchanged. Record a new decision to act on it.";
const CHANGES_LABEL = "What changed";
const NO_HAZARD_WINDOW = "None";
const WINDOW_SEPARATOR = "–";
const ARROW = "→";

const FIELD_LABELS: Record<RecommendationChange["field"], string> = {
  posture: "Posture",
  confidence: "Confidence",
  hazardWindow: "Hazard window",
};

const CONFIDENCE_LABELS: Record<Confidence, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

function windowText(
  window: HazardWindow | null,
  timezone: string,
  facilityDate: string,
): string {
  if (window === null) {
    return NO_HAZARD_WINDOW;
  }
  const start = facilityClock(window.start, timezone, facilityDate);
  const end = facilityClock(window.end, timezone, facilityDate);
  return `${start}${WINDOW_SEPARATOR}${end}`;
}

function changeText(
  change: RecommendationChange,
  timezone: string,
  facilityDate: string,
): string {
  switch (change.field) {
    case "posture":
      return `${POSTURE_LABELS[change.from]} ${ARROW} ${POSTURE_LABELS[change.to]}`;
    case "confidence":
      return `${CONFIDENCE_LABELS[change.from]} ${ARROW} ${CONFIDENCE_LABELS[change.to]}`;
    case "hazardWindow":
      return `${windowText(change.from, timezone, facilityDate)} ${ARROW} ${windowText(change.to, timezone, facilityDate)}`;
    default:
      return change satisfies never;
  }
}

/** Informs only; the decided record stays the one of record until someone decides again. */
export function NewerRecommendationBanner({
  decided,
  latest,
  timezone,
}: {
  decided: ComparedRecommendation;
  latest: ComparedRecommendation;
  timezone: string;
}): JSX.Element | null {
  if (decided.id === latest.id) {
    return null;
  }
  const { facilityDate } = latest.snapshot.output;
  return (
    <Alert role="status">
      <AlertTitle>{TITLE}</AlertTitle>
      <AlertDescription>
        <ul aria-label={CHANGES_LABEL}>
          {recommendationChanges(decided, latest).map((change) => (
            <li key={change.field}>
              {`${FIELD_LABELS[change.field]}: ${changeText(change, timezone, facilityDate)}`}
            </li>
          ))}
        </ul>
        <p>{UNCHANGED_TEXT}</p>
      </AlertDescription>
    </Alert>
  );
}
