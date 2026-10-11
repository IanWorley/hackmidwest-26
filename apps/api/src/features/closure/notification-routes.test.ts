import { notificationDispatches, recommendations } from "@hackmidwest/db";
import {
  createTestDatabaseWithDemoFacilities,
  DEMO_ROSTER_CASES,
} from "@hackmidwest/db/testing";
import { asc } from "drizzle-orm";
import { expect, it } from "vitest";
import { HTTP_CONFLICT, HTTP_CREATED, HTTP_OK } from "../../runtime";
import {
  ACCEPT,
  appRunner,
  type Db,
  DECIDE_BY,
  DECIDED_AT,
  DEFER,
  decide,
  FACILITY_ID,
  FIRST_DECISION_ID,
  NEWER_RECOMMENDATION_ID,
  OVERRIDE,
  SECOND_DECISION_ID,
} from "./decision-test-fixtures";
import { evaluatePosture } from "./engine";
import type { EngineInput } from "./engine-input";
import { input, nwsAlert } from "./engine-test-fixtures";
import { contentHash, type JsonValue } from "./records";

const withApp = appRunner(createTestDatabaseWithDemoFacilities);

// 2026-10-02 is CDT (UTC-5): evaluated just before the 05:00 local decision deadline.
const EVALUATED_AT = "2026-10-02T09:55:00.000Z";
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

function dispatchCount(db: Db): Promise<number> {
  return db.$count(notificationDispatches);
}

// Kansas City's seeded employees are ids 1 through 20; under a full closure everyone is told
// except those whose baseline already keeps them away.
const KANSAS_CITY_EMPLOYEE_COUNT = 20;
const STAYING_AWAY_IDS: readonly number[] = [
  DEMO_ROSTER_CASES.alreadyTeleworkingEmployeeId,
  DEMO_ROSTER_CASES.onDetailEmployeeId,
  DEMO_ROSTER_CASES.onLeaveEmployeeId,
];
const KANSAS_CITY_RECIPIENT_IDS = Array.from(
  { length: KANSAS_CITY_EMPLOYEE_COUNT },
  (_, index) => index + 1,
).filter((id) => !STAYING_AWAY_IDS.includes(id));

function employeeIds(recipients: readonly { employeeId: number }[]): number[] {
  return recipients.map(({ employeeId }) => employeeId);
}

it("previews who the recommendation would notify without recording a dispatch", async () => {
  await withApp(async ({ db, request }) => {
    await recommend(db, STORM);

    const response = await request(preview());
    const body = await response.json();

    expect([
      response.status,
      body.source,
      body.posture,
      employeeIds(body.recipients),
      await dispatchCount(db),
    ]).toEqual([
      HTTP_OK,
      { kind: "preview", recommendationId: NEWER_RECOMMENDATION_ID },
      { posture: "full_closure" },
      KANSAS_CITY_RECIPIENT_IDS,
      0,
    ]);
  });
});

it("records one dispatch per recipient", async () => {
  await withApp(async ({ db, request }) => {
    await recommend(db, STORM);
    await request(decide(NEWER_RECOMMENDATION_ID), ACCEPT);

    const response = await request(dispatch(), {});
    const body = await response.json();

    expect([
      response.status,
      employeeIds(body.dispatches),
      employeeIds(
        await db
          .select()
          .from(notificationDispatches)
          .orderBy(asc(notificationDispatches.employeeId)),
      ),
    ]).toEqual([
      HTTP_CREATED,
      KANSAS_CITY_RECIPIENT_IDS,
      KANSAS_CITY_RECIPIENT_IDS,
    ]);
  });
});

it("refuses a second dispatch of the same decision and writes nothing", async () => {
  await withApp(async ({ db, request }) => {
    await recommend(db, STORM);
    await request(decide(NEWER_RECOMMENDATION_ID), ACCEPT);
    await request(dispatch(), {});

    const response = await request(dispatch(), {});

    expect([
      response.status,
      await response.json(),
      await dispatchCount(db),
    ]).toEqual([
      HTTP_CONFLICT,
      {
        conflict: "already_dispatched",
        message: "This decision was already dispatched",
        recordedAt: DECIDED_AT,
      },
      KANSAS_CITY_RECIPIENT_IDS.length,
    ]);
  });
});

it("keeps the decision chain intact after a dispatch", async () => {
  await withApp(async ({ db, request }) => {
    await recommend(db, STORM);
    await request(decide(NEWER_RECOMMENDATION_ID), ACCEPT);
    await request(dispatch(), {});

    const response = await request(
      `/api/decisions/${FIRST_DECISION_ID}/verify`,
    );

    expect(await response.json()).toEqual({
      decisionId: FIRST_DECISION_ID,
      intact: true,
      breaks: [],
    });
  });
});

it.each([
  { route: "notifications", path: notifications(), body: undefined },
  { route: "dispatch", path: dispatch(), body: {} },
])(
  "refuses $route for a deferral, which sets no posture",
  async ({ path, body }) => {
    await withApp(async ({ db, request }) => {
      await recommend(db, STORM);
      await request(decide(NEWER_RECOMMENDATION_ID), DEFER);

      const response = await request(path, body);

      expect([response.status, await response.json()]).toEqual([
        HTTP_CONFLICT,
        {
          conflict: "no_posture",
          message:
            "This decision sets no posture, so there is nothing to notify",
          action: "defer",
        },
      ]);
    });
  },
);

it("refuses to dispatch a decision a later decision supersedes", async () => {
  await withApp(async ({ db, request }) => {
    await recommend(db, STORM);
    await request(decide(NEWER_RECOMMENDATION_ID), ACCEPT);
    await request(decide(NEWER_RECOMMENDATION_ID), {
      ...OVERRIDE,
      chosenPosture: "unscheduled_telework",
      supersedesDecisionId: FIRST_DECISION_ID,
    });

    const response = await request(dispatch(FIRST_DECISION_ID), {});

    expect([
      response.status,
      await response.json(),
      await dispatchCount(db),
    ]).toEqual([
      HTTP_CONFLICT,
      {
        conflict: "decision_superseded",
        message:
          "A later decision supersedes this one, so only the latest can be dispatched",
        latestDecisionId: SECOND_DECISION_ID,
      },
      0,
    ]);
  });
});

it("dispatches a package with nobody to tell without recording a row", async () => {
  await withApp(async ({ db, request }) => {
    await recommend(db, CLEAR);
    await request(decide(NEWER_RECOMMENDATION_ID), ACCEPT);

    const response = await request(dispatch(), {});
    const body = await response.json();

    expect([
      response.status,
      body.package.recipients,
      body.dispatches,
      await dispatchCount(db),
    ]).toEqual([HTTP_CREATED, [], [], 0]);
  });
});
