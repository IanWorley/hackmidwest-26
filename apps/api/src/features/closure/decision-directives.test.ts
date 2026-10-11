import {
  createTestDatabaseWithDemoFacilities,
  DEMO_ROSTER_CASES,
} from "@hackmidwest/db/testing";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HTTP_CREATED, HTTP_NOT_FOUND, HTTP_OK } from "../../runtime";
import { HTTP_CONFLICT, HTTP_UNPROCESSABLE } from "./decision-request";
import type { DecisionTestApp } from "./decision-test-app";
import {
  DANA_WHITFIELD_ID,
  DECIDE_PATH,
  ROAD_REPORTS,
} from "./decision-test-app";
import {
  ESSENTIAL_REPORT,
  FIRST_DIRECTIVES_PATH,
  PLANT_OPERATORS,
  withDecidedAppOn,
} from "./directive-test-app";
import { CLOCK, UNKNOWN_ID } from "./recommendation-test-app";

const KANSAS_CITY_ANNEX_ID = 2;
const FARGO_MAIN_OFFICE_ID = 4;
const FARGO_EMPLOYEE_ID = 21;
const EARLIER_RELEASE_OFFSET = "2026-01-14T11:30:00-06:00";
const EARLIER_RELEASE_UTC = "2026-01-14T17:30:00.000Z";
function withDecidedApp(
  run: (app: DecisionTestApp) => Promise<void>,
): Promise<void> {
  return withDecidedAppOn(createTestDatabaseWithDemoFacilities, run);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(CLOCK) });
});

afterEach(() => {
  vi.useRealTimers();
});

it(`POST ${FIRST_DIRECTIVES_PATH} records a directive linked by id and hash to the decision`, async () => {
  await withDecidedApp(async ({ get, post }) => {
    const [decision] = await (await get("/api/facilities/1/decisions")).json();

    const response = await post(FIRST_DIRECTIVES_PATH, ESSENTIAL_REPORT);

    expect(response.status).toBe(HTTP_CREATED);
    const { contentHash, ...directive } = await response.json();
    expect(directive).toEqual({
      id: 1,
      decisionId: 1,
      decisionHash: decision.contentHash,
      scope: { kind: "group", group: "essential" },
      directive: "report",
      effectiveAt: null,
      reasonCategory: "essential_operations",
      reasonText: PLANT_OPERATORS.text,
      issuedById: DANA_WHITFIELD_ID,
      issuedAt: CLOCK,
    });
  });
});

it(`POST ${FIRST_DIRECTIVES_PATH} stores an employee's earlier release in UTC`, async () => {
  await withDecidedApp(async ({ post }) => {
    const response = await post(FIRST_DIRECTIVES_PATH, {
      scope: {
        kind: "employee",
        employeeId: DEMO_ROSTER_CASES.accessibilityNeedsEmployeeId,
      },
      directive: "dismissed",
      effectiveAt: EARLIER_RELEASE_OFFSET,
      reason: ROAD_REPORTS,
      issuedById: DANA_WHITFIELD_ID,
    });

    const { scope, effectiveAt } = await response.json();
    expect([response.status, { scope, effectiveAt }]).toEqual([
      HTTP_CREATED,
      {
        scope: {
          kind: "employee",
          employeeId: DEMO_ROSTER_CASES.accessibilityNeedsEmployeeId,
        },
        effectiveAt: EARLIER_RELEASE_UTC,
      },
    ]);
  });
});

it(`GET ${FIRST_DIRECTIVES_PATH} lists the decision's directives in the order they were issued`, async () => {
  await withDecidedApp(async ({ get, post }) => {
    await post(FIRST_DIRECTIVES_PATH, ESSENTIAL_REPORT);
    await post(FIRST_DIRECTIVES_PATH, {
      ...ESSENTIAL_REPORT,
      scope: { kind: "building", buildingId: KANSAS_CITY_ANNEX_ID },
      directive: "telework",
    });

    const response = await get(FIRST_DIRECTIVES_PATH);

    const directives: { id: number; scope: unknown; directive: string }[] =
      await response.json();
    expect([
      response.status,
      directives.map(({ id, scope, directive }) => ({ id, scope, directive })),
    ]).toEqual([
      HTTP_OK,
      [
        {
          id: 1,
          scope: { kind: "group", group: "essential" },
          directive: "report",
        },
        {
          id: 2,
          scope: { kind: "building", buildingId: KANSAS_CITY_ANNEX_ID },
          directive: "telework",
        },
      ],
    ]);
  });
});

it.each([
  {
    case: "a directive without a reason",
    body: { reason: undefined },
    field: "reason",
  },
  {
    case: "a blank reason",
    body: { reason: { category: "other", text: " " } },
    field: "reason.text",
  },
  {
    case: "an issuer who is not a decision maker",
    body: { issuedById: UNKNOWN_ID },
    field: "issuedById",
  },
  {
    case: "a release time on a directive other than a dismissal",
    body: { effectiveAt: EARLIER_RELEASE_OFFSET },
    field: "effectiveAt",
  },
  {
    case: "a building in another facility",
    body: { scope: { kind: "building", buildingId: FARGO_MAIN_OFFICE_ID } },
    field: "scope",
  },
  {
    case: "an employee in another facility",
    body: { scope: { kind: "employee", employeeId: FARGO_EMPLOYEE_ID } },
    field: "scope",
  },
  {
    case: "a group the app does not know",
    body: { scope: { kind: "group", group: "managers" } },
    field: "scope",
  },
  {
    case: "an unknown property",
    body: { issuedByName: "Dana" },
    field: "issuedByName",
  },
])(
  `POST ${FIRST_DIRECTIVES_PATH} rejects $case with a 422 naming $field`,
  async ({ body, field }) => {
    await withDecidedApp(async ({ post }) => {
      const response = await post(FIRST_DIRECTIVES_PATH, {
        ...ESSENTIAL_REPORT,
        ...body,
      });

      expect([response.status, await response.json()]).toEqual([
        HTTP_UNPROCESSABLE,
        { message: "Invalid directive", field },
      ]);
    });
  },
);

it(`POST ${FIRST_DIRECTIVES_PATH} returns 409 with the current decision's id when the decision was superseded`, async () => {
  await withDecidedApp(async ({ post }) => {
    await post(DECIDE_PATH, {
      action: "override",
      posture: "delayed_arrival",
      reason: ROAD_REPORTS,
      supersedesDecisionId: 1,
      decidedById: DANA_WHITFIELD_ID,
    });

    const response = await post(FIRST_DIRECTIVES_PATH, ESSENTIAL_REPORT);

    expect([response.status, await response.json()]).toEqual([
      HTTP_CONFLICT,
      {
        conflict: "decision_superseded",
        message:
          "This decision was superseded; issue directives on the current one",
        latestDecisionId: 2,
      },
    ]);
  });
});

it.each(["post", "get"] as const)(
  "%s on an unknown decision's directives returns 404",
  async (method) => {
    await withDecidedApp(async (app) => {
      const path = `/api/decisions/${UNKNOWN_ID}/directives`;

      const response = await app[method](path, ESSENTIAL_REPORT);

      expect([response.status, await response.json()]).toEqual([
        HTTP_NOT_FOUND,
        { message: "Decision not found" },
      ]);
    });
  },
);

it("blocks an UPDATE to a recorded directive", async () => {
  await withDecidedApp(async ({ db, post }) => {
    await post(FIRST_DIRECTIVES_PATH, ESSENTIAL_REPORT);

    await expect(
      db.run(sql`update decision_directives set directive = 'dismissed'`),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining(
          "decision_directives is add-only: record a newer directive instead of updating one",
        ),
      },
    });
  });
});
