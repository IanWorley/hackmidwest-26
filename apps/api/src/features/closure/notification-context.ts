import type { FacilityPosture } from "./effective-status";
import type { AlertUrgency, NoticeContext } from "./notification-plan";
import type { HazardSpan } from "./notification-situation";
import type { Finding } from "./recommendation";
import type { Snapshot } from "./recommendation-snapshot";

const NO_ALERT_URGENCY: AlertUrgency = "Unknown";

interface NoticeContextInput {
  readonly facility: NoticeContext["facility"];
  readonly snapshot: Snapshot;
  readonly posture: FacilityPosture;
  readonly now: string;
}

function hazardOf(deciding: Finding | undefined): HazardSpan | null {
  if (deciding === undefined) {
    return null;
  }
  const { start, end } = deciding.timing.hazardWindow;
  return { kind: deciding.hazard, start, end };
}

function urgencyOf(
  deciding: Finding | undefined,
  alerts: Snapshot["input"]["alerts"]["items"],
): AlertUrgency {
  const alertIds = new Set(
    (deciding?.signals ?? []).flatMap(({ origin }) => {
      if (origin.source === "alerts") {
        return [origin.ref];
      }
      return [];
    }),
  );
  return alerts.find(({ id }) => alertIds.has(id))?.urgency ?? NO_ALERT_URGENCY;
}

/** The deciding finding is the first, so its hazard and alert set the notice's framing and urgency. */
function noticeContext({
  facility,
  snapshot,
  posture,
  now,
}: NoticeContextInput): NoticeContext {
  const [deciding] = snapshot.output.findings;
  return {
    facility,
    facilityDate: snapshot.output.facilityDate,
    posture,
    hazard: hazardOf(deciding),
    urgency: urgencyOf(deciding, snapshot.input.alerts.items),
    now,
  };
}

export { noticeContext };
