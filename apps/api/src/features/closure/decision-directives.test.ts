import { decisionDirectives } from "@hackmidwest/db";
import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { expect, it } from "vitest";
import {
  HTTP_CREATED,
  HTTP_NOT_FOUND,
  HTTP_OK,
  HTTP_UNPROCESSABLE_ENTITY,
} from "../../runtime";
import type { ValidationErrorBody } from "./decision-body";
import {
  ACCEPT,
  appRunner,
  DECIDED_AT,
  DECIDER_ID,
  decide,
  FIRST_DECISION_ID,
  SHA256_HEX,
  storedDecisions,
  UNKNOWN_ID,
} from "./decision-test-fixtures";

const withApp = appRunner(createTestDatabaseWithDemoFacilities);

const DIRECTIVES_PATH = `/api/decisions/${FIRST_DECISION_ID}/directives`;
const ANNEX_ID = 2;
const ACCESSIBILITY_NEEDS_EMPLOYEE_ID = 8;
// Fargo's Main Office and one of its employees; the fixture decision is for Kansas City.
const FARGO_MAIN_OFFICE_ID = 4;
const FARGO_EMPLOYEE_ID = 21;
// Grace Lindqvist decides for Fargo, not Kansas City.
const OTHER_FACILITY_DECIDER_ID = 5;
const EARLIER_RELEASE_AT = "2026-10-02T17:30:00.000Z";
const PLANT_OPERATORS = {
  category: "essential_operations",
  text: "Plant operators keep the boilers running.",
} as const;
const ESSENTIAL_REPORT = {
  scope: { kind: "group", group: "essential" },
  directive: "report",
  reason: PLANT_OPERATORS,
  issuedById: DECIDER_ID,
} as const;

function validation(property: string, message: string): ValidationErrorBody {
  return { type: "validation", on: "body", property, message };
}

it.each([
  { scope: { kind: "facility" }, stored: "facility" },
  { scope: { kind: "group", group: "essential" }, stored: "group:essential" },
  { scope: { kind: "building", buildingId: ANNEX_ID }, stored: "building:2" },
  {
    scope: { kind: "employee", employeeId: ACCESSIBILITY_NEEDS_EMPLOYEE_ID },
    stored: "employee:8",
  },
] as const)(
  "records a $scope.kind directive linked to the decision it names",
  async ({ scope, stored }) => {
    await withApp(async ({ db, request }) => {
      await request(decide(), ACCEPT);
      const [decision] = await storedDecisions(db);

      const response = await request(DIRECTIVES_PATH, {
        ...ESSENTIAL_REPORT,
        scope,
        directive: "dismissed",
        effectiveAt: EARLIER_RELEASE_AT,
      });

      expect([
        response.status,
        await response.json(),
        await db
          .select({ scope: decisionDirectives.scope })
          .from(decisionDirectives),
      ]).toEqual([
        HTTP_CREATED,
        {
          id: 1,
          decisionId: FIRST_DECISION_ID,
          decisionHash: decision?.contentHash,
          scope,
          directive: "dismissed",
          effectiveAt: EARLIER_RELEASE_AT,
          reasonCategory: "essential_operations",
          reasonText: "Plant operators keep the boilers running.",
          issuedById: DECIDER_ID,
          issuedByName: "Dana Whitfield",
          issuedByRole: "County Executive Director",
          issuedAt: DECIDED_AT,
          contentHash: expect.stringMatching(SHA256_HEX),
        },
        [{ scope: stored }],
      ]);
    });
  },
);

it("lists a decision's directives oldest first", async () => {
  await withApp(async ({ request }) => {
    await request(decide(), ACCEPT);
    await request(DIRECTIVES_PATH, ESSENTIAL_REPORT);
    await request(DIRECTIVES_PATH, {
      ...ESSENTIAL_REPORT,
      scope: { kind: "facility" },
      directive: "telework",
    });

    const response = await request(DIRECTIVES_PATH);
    const listed: { id: number; directive: string }[] = await response.json();

    expect([
      response.status,
      listed.map(({ id, directive }) => ({ id, directive })),
    ]).toEqual([
      HTTP_OK,
      [
        { id: 1, directive: "report" },
        { id: 2, directive: "telework" },
      ],
    ]);
  });
});

it.each([
  { case: "POST", body: ESSENTIAL_REPORT },
  { case: "GET", body: undefined },
])(
  "returns 404 to $case for a decision that does not exist",
  async ({ body }) => {
    await withApp(async ({ request }) => {
      const response = await request(
        `/api/decisions/${UNKNOWN_ID}/directives`,
        body,
      );

      expect([response.status, await response.json()]).toEqual([
        HTTP_NOT_FOUND,
        { message: "Decision not found" },
      ]);
    });
  },
);

it.each([
  {
    case: "without a reason",
    body: { ...ESSENTIAL_REPORT, reason: undefined },
    error: validation("/reason", "Expected required property"),
  },
  {
    case: "with a blank reason",
    body: { ...ESSENTIAL_REPORT, reason: { ...PLANT_OPERATORS, text: " " } },
    error: validation("/reason/text", "Expected string to match '\\S'"),
  },
  {
    case: "from someone who is not a decision maker",
    body: { ...ESSENTIAL_REPORT, issuedById: UNKNOWN_ID },
    error: validation(
      "/issuedById",
      "Only the facility's decision maker or its backup can issue a directive",
    ),
  },
  {
    case: "from another facility's decision maker",
    body: { ...ESSENTIAL_REPORT, issuedById: OTHER_FACILITY_DECIDER_ID },
    error: validation(
      "/issuedById",
      "Only the facility's decision maker or its backup can issue a directive",
    ),
  },
  {
    case: "with a release time on a report directive",
    body: { ...ESSENTIAL_REPORT, effectiveAt: EARLIER_RELEASE_AT },
    error: validation(
      "/effectiveAt",
      "Only a dismissed directive takes an effectiveAt release time",
    ),
  },
  {
    case: "for another facility's building",
    body: {
      ...ESSENTIAL_REPORT,
      scope: { kind: "building", buildingId: FARGO_MAIN_OFFICE_ID },
    },
    error: validation(
      "/scope",
      "The scope must name a building or employee of the decision's facility",
    ),
  },
  {
    case: "for another facility's employee",
    body: {
      ...ESSENTIAL_REPORT,
      scope: { kind: "employee", employeeId: FARGO_EMPLOYEE_ID },
    },
    error: validation(
      "/scope",
      "The scope must name a building or employee of the decision's facility",
    ),
  },
  {
    case: "with an unknown top-level field",
    body: { ...ESSENTIAL_REPORT, priority: "high" },
    error: validation("/priority", "Unexpected property"),
  },
  {
    case: "with an unknown field in its scope",
    body: {
      ...ESSENTIAL_REPORT,
      scope: { kind: "facility", buildingId: ANNEX_ID },
    },
    error: validation("/scope/buildingId", "Unexpected property"),
  },
  {
    case: "with an unknown field in its reason",
    body: {
      ...ESSENTIAL_REPORT,
      reason: { ...PLANT_OPERATORS, severity: "high" },
    },
    error: validation("/reason/severity", "Unexpected property"),
  },
  {
    case: "with an unknown scope kind",
    body: { ...ESSENTIAL_REPORT, scope: { kind: "team" } },
    error: validation(
      "/scope",
      "Expected scope kind facility, group, building, or employee",
    ),
  },
  {
    case: "with a building id that is not an integer",
    body: {
      ...ESSENTIAL_REPORT,
      scope: { kind: "building", buildingId: "two" },
    },
    error: validation("/scope/buildingId", "Expected union value"),
  },
])("rejects a directive $case", async ({ body, error }) => {
  await withApp(async ({ db, request }) => {
    await request(decide(), ACCEPT);

    const response = await request(DIRECTIVES_PATH, body);

    expect([
      response.status,
      await response.json(),
      await db.select().from(decisionDirectives),
    ]).toEqual([HTTP_UNPROCESSABLE_ENTITY, error, []]);
  });
});

it.each([
  "2026-02-30T10:00:00.000Z",
  "2026-10-02T17:30:00Z",
  "-000001-01-01T00:00:00.000Z",
  "+275760-09-13T00:00:00.000Z",
])("rejects the release time %s as invalid input", async (effectiveAt) => {
  await withApp(async ({ request }) => {
    await request(decide(), ACCEPT);

    const response = await request(DIRECTIVES_PATH, {
      ...ESSENTIAL_REPORT,
      directive: "dismissed",
      effectiveAt,
    });

    expect([response.status, await response.json()]).toEqual([
      HTTP_UNPROCESSABLE_ENTITY,
      validation(
        "/effectiveAt",
        "Expected string to match 'utc-instant' format",
      ),
    ]);
  });
});
