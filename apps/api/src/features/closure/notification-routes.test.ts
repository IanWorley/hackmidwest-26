import { notificationDispatches } from "@hackmidwest/db";
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
  DECIDED_AT,
  decide,
  FIRST_DECISION_ID,
  NEWER_RECOMMENDATION_ID,
} from "./decision-test-fixtures";
import {
  dispatchCount,
  dispatchReviewed,
  employeeIds,
  notifications,
  preview,
  recommend,
  STORM,
} from "./notification-route-test-fixtures";

const withApp = appRunner(createTestDatabaseWithDemoFacilities);

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

const EXCUSED_EMPLOYEE_ID = 1;
const DECIDER_ID = 1;

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

it("leaves out an employee a stored directive excuses", async () => {
  await withApp(async ({ db, request }) => {
    await recommend(db, STORM);
    await request(decide(NEWER_RECOMMENDATION_ID), ACCEPT);
    await request(`/api/decisions/${FIRST_DECISION_ID}/directives`, {
      scope: { kind: "employee", employeeId: EXCUSED_EMPLOYEE_ID },
      directive: "excused",
      reason: {
        category: "other",
        text: "Approved leave for a family emergency.",
      },
      issuedById: DECIDER_ID,
    });

    const body = await (await request(notifications())).json();

    expect([
      employeeIds(body.package.recipients),
      body.package.exclusions.filter(
        ({ kind }: { kind: string }) => kind === "excused",
      ),
    ]).toEqual([
      KANSAS_CITY_RECIPIENT_IDS.filter((id) => id !== EXCUSED_EMPLOYEE_ID),
      [
        {
          kind: "excused",
          employeeId: EXCUSED_EMPLOYEE_ID,
          name: "Avery Calloway",
          reason: "Approved leave for a family emergency.",
        },
      ],
    ]);
  });
});

it("records one dispatch per recipient", async () => {
  await withApp(async ({ db, request }) => {
    await recommend(db, STORM);
    await request(decide(NEWER_RECOMMENDATION_ID), ACCEPT);

    const response = await dispatchReviewed(request);
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
    await dispatchReviewed(request);

    const response = await dispatchReviewed(request);

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
    await dispatchReviewed(request);

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
