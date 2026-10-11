import { ALERT_URGENCIES } from "../../clients/nws-model";
import type { FacilityPosture } from "./effective-status";
import type { AlertUrgency, NoticeContext } from "./notification-plan";
import type { HazardSpan } from "./notification-situation";
import type { Snapshot } from "./recommendation-store";

const NO_ALERT_URGENCY: AlertUrgency = "Unknown";

type StoredFinding = Snapshot["output"]["findings"][number];

function moreUrgent(a: AlertUrgency, b: AlertUrgency): AlertUrgency {
  // The client lists urgencies most urgent first.
  if (ALERT_URGENCIES.indexOf(b) < ALERT_URGENCIES.indexOf(a)) {
    return b;
  }
  return a;
}

interface NoticeContextInput {
  readonly facility: NoticeContext["facility"];
  readonly snapshot: Snapshot;
  readonly posture: FacilityPosture;
  readonly now: string;
}

function hazardOf(deciding: StoredFinding | undefined): HazardSpan | null {
  if (deciding === undefined) {
    return null;
  }
  const { start, end } = deciding.timing.hazardWindow;
  return { kind: deciding.hazard, start, end };
}

function urgencyOf(
  deciding: StoredFinding | undefined,
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
  return alerts
    .filter(({ id }) => alertIds.has(id))
    .map(({ urgency }) => urgency)
    .reduce(moreUrgent, NO_ALERT_URGENCY);
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
