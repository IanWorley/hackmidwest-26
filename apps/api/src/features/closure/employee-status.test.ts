import { employeeStatusEvents } from "@hackmidwest/db";
import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { desc } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  HTTP_CREATED,
  HTTP_NOT_FOUND,
  HTTP_UNPROCESSABLE_ENTITY,
} from "../../runtime";
import {
  appRunner,
  BACKUP_ID,
  DECIDED_AT,
  EMPLOYEE_ID,
  UNKNOWN_ID,
} from "./decision-test-fixtures";

const withApp = appRunner(createTestDatabaseWithDemoFacilities);

/** Priya Raman decides for Yakima and Lafayette, not Kansas City. */
const OTHER_FACILITY_DECIDER_ID = 3;
const LATER = "2026-10-02T14:00:00.000Z";
const ON_LEAVE = {
  status: "not_working",
  note: "Family leave through Friday.",
  reportedById: BACKUP_ID,
} as const;

function statusPath(employeeId: number | string): string {
  return `/api/employees/${employeeId}/status`;
}

it("appends a status event recorded now, effective now unless the body schedules it", async () => {
  await withApp(async ({ db, request }) => {
    const now = await request(statusPath(EMPLOYEE_ID), ON_LEAVE);
    const scheduled = await request(statusPath(EMPLOYEE_ID), {
      status: "teleworking",
      reportedById: BACKUP_ID,
      effectiveFrom: LATER,
    });

    expect(now.status).toBe(HTTP_CREATED);
    expect(scheduled.status).toBe(HTTP_CREATED);
    const stored = await db
      .select()
      .from(employeeStatusEvents)
      .orderBy(desc(employeeStatusEvents.id))
      .limit(2)
      .all();
    expect(stored.reverse()).toEqual([
      await now.json(),
      await scheduled.json(),
    ]);
    expect(stored).toMatchObject([
      {
        employeeId: EMPLOYEE_ID,
        status: "not_working",
        note: ON_LEAVE.note,
        reportedAt: DECIDED_AT,
        effectiveFrom: DECIDED_AT,
      },
      {
        employeeId: EMPLOYEE_ID,
        status: "teleworking",
        note: null,
        reportedAt: DECIDED_AT,
        effectiveFrom: LATER,
      },
    ]);
  });
});

it.each([
  {
    name: "reportedById is missing",
    body: { status: "teleworking" },
    property: "/reportedById",
    message: "Expected required property",
  },
  {
    name: "the reporter decides for another facility",
    body: { ...ON_LEAVE, reportedById: OTHER_FACILITY_DECIDER_ID },
    property: "/reportedById",
    message:
      "Only the facility's decision maker or its backup can record a status",
  },
  {
    name: "a not_working status has no note",
    body: { status: "not_working", reportedById: BACKUP_ID },
    property: "/note",
    message: "A not_working status needs a note",
  },
  {
    name: "the note is blank",
    body: { ...ON_LEAVE, note: "  " },
    property: "/note",
    message: "Expected string to match '\\S'",
  },
])(
  "answers 422 and records nothing when $name",
  async ({ body, property, message }) => {
    await withApp(async ({ db, request }) => {
      const before = await db.$count(employeeStatusEvents);

      const response = await request(statusPath(EMPLOYEE_ID), body);

      expect(response.status).toBe(HTTP_UNPROCESSABLE_ENTITY);
      expect(await response.json()).toEqual({
        type: "validation",
        on: "body",
        property,
        message,
      });
      expect(await db.$count(employeeStatusEvents)).toBe(before);
    });
  },
);

it("answers 404 for an unknown employee", async () => {
  await withApp(async ({ request }) => {
    const response = await request(statusPath(UNKNOWN_ID), ON_LEAVE);

    expect(response.status).toBe(HTTP_NOT_FOUND);
    expect(await response.json()).toEqual({ message: "Employee not found" });
  });
});
