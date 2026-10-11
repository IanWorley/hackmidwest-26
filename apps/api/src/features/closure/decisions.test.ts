import { notificationDispatches } from "@hackmidwest/db";
import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HTTP_CREATED } from "../../runtime";
import { HTTP_CONFLICT, HTTP_UNPROCESSABLE } from "./decision-request";
import {
  DANA_WHITFIELD_ID,
  DECIDE_PATH,
  type DecisionTestApp,
  ROAD_REPORTS,
  withDecisionAppOn,
} from "./decision-test-app";
import { CLOCK } from "./recommendation-test-app";

const RECHECK_AT = "2026-01-14T10:15:00-00:00";
const NIGHT_SHIFT = "Night shift supervisor";
const UNPLOWED_LOT = "The north lot has not been plowed.";

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

it(`POST ${DECIDE_PATH} records an accept linked by id and hash to what the person saw`, async () => {
  await withDecisionApp(async ({ evaluate, post }) => {
    const recommendation = await (await evaluate()).json();

    const response = await post(DECIDE_PATH, {
      action: "accept",
      decidedById: DANA_WHITFIELD_ID,
      humanInputs: [{ reportedBy: NIGHT_SHIFT, text: UNPLOWED_LOT }],
    });

    expect(response.status).toBe(HTTP_CREATED);
    const { contentHash, ...decision } = await response.json();
    expect(decision).toEqual({
      id: 1,
      recommendationId: 1,
      recommendationHash: recommendation.contentHash,
      facilityId: 1,
      action: "accept",
      chosenPosture: "full_closure",
      decidedById: DANA_WHITFIELD_ID,
      decidedByName: "Dana Whitfield",
      decidedByRole: "County Executive Director",
      decidedAt: CLOCK,
      identityVerified: false,
      reasonCategory: null,
      reasonText: null,
      recheckAt: null,
      supersedesDecisionId: null,
      humanInputs: [
        {
          id: 1,
          decisionId: 1,
          reportedBy: NIGHT_SHIFT,
          reportedAt: CLOCK,
          text: UNPLOWED_LOT,
        },
      ],
      decideBy: "2026-01-14T11:00:00.000Z",
      minutesBeforeDecideBy: 90,
    });
  });
});

it(`POST ${DECIDE_PATH} records an override with the chosen posture and its reason`, async () => {
  await withDecisionApp(async ({ evaluate, post }) => {
    await evaluate();

    const response = await post(DECIDE_PATH, {
      action: "override",
      posture: "unscheduled_telework",
      reason: ROAD_REPORTS,
      decidedById: DANA_WHITFIELD_ID,
    });

    const { action, chosenPosture, reasonCategory, reasonText } =
      await response.json();
    expect([
      response.status,
      { action, chosenPosture, reasonCategory, reasonText },
    ]).toEqual([
      HTTP_CREATED,
      {
        action: "override",
        chosenPosture: "unscheduled_telework",
        reasonCategory: "road_reports",
        reasonText: ROAD_REPORTS.text,
      },
    ]);
  });
});

it(`POST ${DECIDE_PATH} records a deferral with its re-check time in UTC and no posture`, async () => {
  await withDecisionApp(async ({ evaluate, post }) => {
    await evaluate();

    const response = await post(DECIDE_PATH, {
      action: "defer",
      recheckAt: RECHECK_AT,
      reason: ROAD_REPORTS,
      decidedById: DANA_WHITFIELD_ID,
    });

    const { action, chosenPosture, recheckAt } = await response.json();
    expect([response.status, { action, chosenPosture, recheckAt }]).toEqual([
      HTTP_CREATED,
      {
        action: "defer",
        chosenPosture: null,
        recheckAt: "2026-01-14T10:15:00.000Z",
      },
    ]);
  });
});

it(`POST ${DECIDE_PATH} returns 409 with the newer recommendation's id when the person decided on an older one`, async () => {
  await withDecisionApp(async ({ evaluate, post }) => {
    await evaluate();
    await evaluate();

    const response = await post(DECIDE_PATH, {
      action: "accept",
      decidedById: DANA_WHITFIELD_ID,
    });

    expect([response.status, await response.json()]).toEqual([
      HTTP_CONFLICT,
      {
        conflict: "newer_recommendation",
        message: "A newer recommendation exists for this facility",
        latestRecommendationId: 2,
      },
    ]);
  });
});

it(`POST ${DECIDE_PATH} returns 409 with the current decision's id when a change does not name it`, async () => {
  await withDecisionApp(async ({ evaluate, post }) => {
    await evaluate();
    const accept = { action: "accept", decidedById: DANA_WHITFIELD_ID };
    await post(DECIDE_PATH, accept);

    const response = await post(DECIDE_PATH, accept);

    expect([response.status, await response.json()]).toEqual([
      HTTP_CONFLICT,
      {
        conflict: "decision_changed",
        message:
          "The decision on this recommendation changed since it was loaded",
        latestDecisionId: 1,
      },
    ]);
  });
});

it(`POST ${DECIDE_PATH} records a change as a new row that supersedes the current decision`, async () => {
  await withDecisionApp(async ({ evaluate, post }) => {
    await evaluate();
    await post(DECIDE_PATH, {
      action: "accept",
      decidedById: DANA_WHITFIELD_ID,
    });

    const response = await post(DECIDE_PATH, {
      action: "override",
      posture: "delayed_arrival",
      reason: ROAD_REPORTS,
      supersedesDecisionId: 1,
      decidedById: DANA_WHITFIELD_ID,
    });

    const { id, supersedesDecisionId } = await response.json();
    expect([response.status, { id, supersedesDecisionId }]).toEqual([
      HTTP_CREATED,
      { id: 2, supersedesDecisionId: 1 },
    ]);
  });
});

it(`POST ${DECIDE_PATH} requires a reason to change a decision, even to accept`, async () => {
  await withDecisionApp(async ({ evaluate, post }) => {
    await evaluate();
    const accept = { action: "accept", decidedById: DANA_WHITFIELD_ID };
    await post(DECIDE_PATH, accept);

    const response = await post(DECIDE_PATH, {
      ...accept,
      supersedesDecisionId: 1,
    });

    expect([response.status, await response.json()]).toEqual([
      HTTP_UNPROCESSABLE,
      { message: "Invalid decision", field: "reason" },
    ]);
  });
});

it(`POST ${DECIDE_PATH} dispatches no notification`, async () => {
  await withDecisionApp(async ({ db, evaluate, post }) => {
    await evaluate();

    await post(DECIDE_PATH, {
      action: "accept",
      decidedById: DANA_WHITFIELD_ID,
    });

    expect(await db.select().from(notificationDispatches)).toEqual([]);
  });
});
