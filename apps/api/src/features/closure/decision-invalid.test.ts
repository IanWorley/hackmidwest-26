import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HTTP_UNPROCESSABLE } from "./decision-request";
import {
  DANA_WHITFIELD_ID,
  DECIDE_PATH,
  type DecisionTestApp,
  ROAD_REPORTS,
  withDecisionAppOn,
} from "./decision-test-app";
import { CLOCK } from "./recommendation-test-app";

const UNKNOWN_DECISION_MAKER_ID = 999;
const RECHECK_AT = "2026-01-14T10:15:00-00:00";
const AFTER_DECIDE_BY = "2026-01-14T11:15:00.000Z";
const NIGHT_SHIFT = "Night shift supervisor";

function withDecisionApp(
  run: (app: DecisionTestApp) => Promise<void>,
): Promise<void> {
  return withDecisionAppOn(createTestDatabaseWithDemoFacilities, run);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(CLOCK) });
});

afterEach(() => {
  vi.useRealTimers();
});

it.each([
  {
    case: "an override without a reason",
    body: { action: "override", posture: "normal" },
    field: "reason",
  },
  {
    case: "a deferral without a reason",
    body: { action: "defer", recheckAt: RECHECK_AT },
    field: "reason",
  },
  {
    case: "a blank reason",
    body: {
      action: "override",
      posture: "normal",
      reason: { category: "other", text: " " },
    },
    field: "reason.text",
  },
  {
    case: "a blank human input",
    body: {
      action: "accept",
      humanInputs: [{ reportedBy: NIGHT_SHIFT, text: "" }],
    },
    field: "humanInputs.0.text",
  },
  { case: "an unknown action", body: { action: "ignore" }, field: "action" },
  {
    case: "an accept that also names a posture",
    body: { action: "accept", posture: "delayed_arrival" },
    field: "posture",
  },
  {
    case: "an override to the recommended posture",
    body: { action: "override", posture: "full_closure", reason: ROAD_REPORTS },
    field: "posture",
  },
  {
    case: "a re-check after the decide-by time",
    body: { action: "defer", recheckAt: AFTER_DECIDE_BY, reason: ROAD_REPORTS },
    field: "recheckAt",
  },
  {
    case: "a decider who is not a decision maker",
    body: { action: "accept", decidedById: UNKNOWN_DECISION_MAKER_ID },
    field: "decidedById",
  },
])(
  `POST ${DECIDE_PATH} rejects $case with a 422 naming $field`,
  async ({ body, field }) => {
    await withDecisionApp(async ({ evaluate, post }) => {
      await evaluate();

      const response = await post(DECIDE_PATH, {
        decidedById: DANA_WHITFIELD_ID,
        ...body,
      });

      expect([response.status, await response.json()]).toEqual([
        HTTP_UNPROCESSABLE,
        { message: "Invalid decision", field },
      ]);
    });
  },
);

it("POST /api/recommendations/0x1/decisions reports a malformed id as the id field", async () => {
  await withDecisionApp(async ({ post }) => {
    const response = await post("/api/recommendations/0x1/decisions", {
      action: "accept",
      decidedById: DANA_WHITFIELD_ID,
    });

    expect([response.status, await response.json()]).toEqual([
      HTTP_UNPROCESSABLE,
      { message: "Invalid decision", field: "id" },
    ]);
  });
});
