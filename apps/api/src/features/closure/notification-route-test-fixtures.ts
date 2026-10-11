import { notificationDispatches, recommendations } from "@hackmidwest/db";
import {
  type Db,
  DECIDE_BY,
  FACILITY_ID,
  FIRST_DECISION_ID,
  NEWER_RECOMMENDATION_ID,
} from "./decision-test-fixtures";
import { evaluatePosture } from "./engine";
import type { EngineInput } from "./engine-input";
import { input, nwsAlert } from "./engine-test-fixtures";
import { contentHash, type JsonValue } from "./records";

// After the fixture placeholder's 10:00Z evaluation, so each stored here is the latest, and before
// the 10:30Z decisions and 11:00Z decideBy.
const EVALUATED_AT = "2026-10-02T10:05:00.000Z";
const STORM: EngineInput["alerts"] = {
  asOf: EVALUATED_AT,
  items: [
    {
      ...nwsAlert("Winter Storm Warning", "Severe"),
      hazardWindow: {
        start: "2026-10-02T06:00:00.000Z",
        end: "2026-10-03T03:00:00.000Z",
        endBasis: "ends",
      },
    },
  ],
};
const CLEAR: EngineInput["alerts"] = { asOf: EVALUATED_AT, items: [] };

function preview(id: number = NEWER_RECOMMENDATION_ID): string {
  return `/api/recommendations/${id}/notifications/preview`;
}

function notifications(decisionId: number = FIRST_DECISION_ID): string {
  return `/api/decisions/${decisionId}/notifications`;
}

function dispatch(decisionId: number = FIRST_DECISION_ID): string {
  return `/api/decisions/${decisionId}/dispatch`;
}

/** Stores an engine-evaluated recommendation for facility 1, newer than the fixture's placeholder. */
async function recommend(db: Db, alerts: EngineInput["alerts"]): Promise<void> {
  const engineInput = input(["winter"], { now: EVALUATED_AT, alerts });
  const output = evaluatePosture(engineInput);
  const snapshot: JsonValue = JSON.parse(
    JSON.stringify({ input: engineInput, output }),
  );
  const content = {
    facilityId: FACILITY_ID,
    evaluatedAt: EVALUATED_AT,
    asOf: EVALUATED_AT,
    posture: output.status.posture,
    confidence: output.confidence.level,
    decideBy: DECIDE_BY,
    snapshot,
  };
  await db
    .insert(recommendations)
    .values({ ...content, contentHash: contentHash(content) });
}

type Request = (path: string, body?: object) => Promise<Response>;

/** A hash no package has, for refusals that answer before the package is compared. */
const UNREVIEWED = { packageHash: "never-shown" } as const;

/** Dispatches the package `GET …/notifications` shows now, as the decision screen does. */
async function dispatchReviewed(
  request: Request,
  decisionId: number = FIRST_DECISION_ID,
): Promise<Response> {
  const shown = await request(notifications(decisionId));
  const { packageHash } = await shown.json();
  return request(dispatch(decisionId), { packageHash });
}

function dispatchCount(db: Db): Promise<number> {
  return db.$count(notificationDispatches);
}

function employeeIds(recipients: readonly { employeeId: number }[]): number[] {
  return recipients.map(({ employeeId }) => employeeId);
}

export {
  CLEAR,
  dispatch,
  dispatchCount,
  dispatchReviewed,
  employeeIds,
  notifications,
  preview,
  recommend,
  STORM,
  UNREVIEWED,
};
