import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HTTP_NOT_FOUND, HTTP_OK } from "../../runtime";
import {
  DANA_WHITFIELD_ID,
  DECIDE_PATH,
  type DecisionTestApp,
  HISTORY_PATH,
  ROAD_REPORTS,
  withDecisionAppOn,
} from "./decision-test-app";
import { CLOCK, UNKNOWN_ID } from "./recommendation-test-app";

const LATE_DECISION_AT = "2026-01-14T11:00:30.000Z";
const DISPATCHER = "County dispatcher";
const ROAD_CLOSED = "Route 9 closed at the river.";

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

it(`GET ${HISTORY_PATH} lists the facility's decisions newest first with their human inputs`, async () => {
  await withDecisionApp(async ({ evaluate, get, post }) => {
    await evaluate();
    await post(DECIDE_PATH, {
      action: "accept",
      decidedById: DANA_WHITFIELD_ID,
    });
    await post(DECIDE_PATH, {
      action: "override",
      posture: "delayed_arrival",
      reason: ROAD_REPORTS,
      supersedesDecisionId: 1,
      decidedById: DANA_WHITFIELD_ID,
      humanInputs: [
        { reportedBy: DISPATCHER, reportedAt: CLOCK, text: ROAD_CLOSED },
      ],
    });

    const response = await get(HISTORY_PATH);

    const history = await response.json();
    expect([
      response.status,
      history.map(
        ({ id, humanInputs }: { id: number; humanInputs: unknown[] }) => ({
          id,
          humanInputs,
        }),
      ),
    ]).toEqual([
      HTTP_OK,
      [
        {
          id: 2,
          humanInputs: [
            {
              id: 1,
              decisionId: 2,
              reportedBy: DISPATCHER,
              reportedAt: CLOCK,
              text: ROAD_CLOSED,
            },
          ],
        },
        { id: 1, humanInputs: [] },
      ],
    ]);
  });
});

it(`GET ${HISTORY_PATH} reports a decision made after decideBy as negative minutes`, async () => {
  await withDecisionApp(async ({ evaluate, get, post }) => {
    await evaluate();
    vi.setSystemTime(new Date(LATE_DECISION_AT));
    await post(DECIDE_PATH, {
      action: "accept",
      decidedById: DANA_WHITFIELD_ID,
    });

    const [decision] = await (await get(HISTORY_PATH)).json();

    expect(decision.minutesBeforeDecideBy).toBe(-1);
  });
});

it(`GET ${HISTORY_PATH} returns 404 for an unknown facility`, async () => {
  await withDecisionApp(async ({ get }) => {
    const response = await get(`/api/facilities/${UNKNOWN_ID}/decisions`);

    expect([response.status, await response.json()]).toEqual([
      HTTP_NOT_FOUND,
      { message: "Facility not found" },
    ]);
  });
});
