import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { employeeStatusEvents, employees, facilities, tasks } from "./schema";
import { seedDemoFacilities } from "./seed";
import { createTestDatabase } from "./testing";

const SEEDED_EMPLOYEE_ID = 1;
const SEEDED_DECISION_MAKER_ID = 1;
const REPORTED_AT = "2026-10-02T13:00:00.000Z";
const IMPOSSIBLE_INSTANT = "2026-02-30T13:00:00.000Z";
const SEEDED_FACILITY_ID = 1;
const PAST_MIDNIGHT = "24:30";
const MISSING_BUILDING_ID = 999;
const HOUR_24_INSTANT = "2026-10-02T24:01:00.000Z";
const BLANK_NOTE = " \t\r\n";
// NWPS lids are upper case; the API would 404 on this one.
const LOWERCASE_GAUGE_ID = "kcdm7";

it("rejects an empty title even when a caller bypasses the HTTP validator", async () => {
  const store = await createTestDatabase();
  try {
    await expect(
      store.db.insert(tasks).values({ title: "" }).execute(),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining(
          "CHECK constraint failed: tasks_title_length",
        ),
      },
    });
  } finally {
    store.close();
  }
});

it("rejects updating a recorded status event", async () => {
  const store = await createTestDatabase();
  try {
    await seedDemoFacilities(store.db);

    await expect(
      store.db
        .update(employeeStatusEvents)
        .set({ status: "teleworking" })
        .where(eq(employeeStatusEvents.employeeId, SEEDED_EMPLOYEE_ID))
        .execute(),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining(
          "employee_status_events is add-only: record a newer event instead of updating one",
        ),
      },
    });
  } finally {
    store.close();
  }
});

it("rejects deleting a recorded status event", async () => {
  const store = await createTestDatabase();
  try {
    await seedDemoFacilities(store.db);

    await expect(
      store.db
        .delete(employeeStatusEvents)
        .where(eq(employeeStatusEvents.employeeId, SEEDED_EMPLOYEE_ID))
        .execute(),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining(
          "employee_status_events is add-only: events cannot be deleted",
        ),
      },
    });
  } finally {
    store.close();
  }
});

it("rejects a not_working status event without a note", async () => {
  const store = await createTestDatabase();
  try {
    await seedDemoFacilities(store.db);

    await expect(
      store.db
        .insert(employeeStatusEvents)
        .values({
          employeeId: SEEDED_EMPLOYEE_ID,
          status: "not_working",
          reportedById: SEEDED_DECISION_MAKER_ID,
          reportedAt: REPORTED_AT,
          effectiveFrom: REPORTED_AT,
        })
        .execute(),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining(
          "CHECK constraint failed: employee_status_events_not_working_requires_note",
        ),
      },
    });
  } finally {
    store.close();
  }
});

it("rejects a status event reported on a date that does not exist", async () => {
  const store = await createTestDatabase();
  try {
    await seedDemoFacilities(store.db);

    await expect(
      store.db
        .insert(employeeStatusEvents)
        .values({
          employeeId: SEEDED_EMPLOYEE_ID,
          status: "teleworking",
          reportedById: SEEDED_DECISION_MAKER_ID,
          reportedAt: IMPOSSIBLE_INSTANT,
          effectiveFrom: REPORTED_AT,
        })
        .execute(),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining(
          "CHECK constraint failed: employee_status_events_reported_at_format",
        ),
      },
    });
  } finally {
    store.close();
  }
});

it("keeps the recorded status event when an INSERT OR REPLACE reuses its id", async () => {
  const store = await createTestDatabase();
  try {
    await seedDemoFacilities(store.db);

    await store.db.run(
      sql`insert or replace into employee_status_events (id, employee_id, status, reported_by_id, reported_at, effective_from) values (${SEEDED_EMPLOYEE_ID}, ${SEEDED_EMPLOYEE_ID}, 'teleworking', ${SEEDED_DECISION_MAKER_ID}, ${REPORTED_AT}, ${REPORTED_AT})`,
    );

    expect(
      await store.db
        .select({ status: employeeStatusEvents.status })
        .from(employeeStatusEvents)
        .where(eq(employeeStatusEvents.id, SEEDED_EMPLOYEE_ID)),
    ).toEqual([{ status: "working_onsite" }]);
  } finally {
    store.close();
  }
});

it("rejects a local time past 23:59", async () => {
  const store = await createTestDatabase();
  try {
    await seedDemoFacilities(store.db);

    await expect(
      store.db
        .update(facilities)
        .set({ arrivalWindowEnd: PAST_MIDNIGHT })
        .where(eq(facilities.id, SEEDED_FACILITY_ID))
        .execute(),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining(
          "CHECK constraint failed: facilities_arrival_window",
        ),
      },
    });
  } finally {
    store.close();
  }
});

it("rejects a facility gauge id that is not an NWPS location id", async () => {
  const store = await createTestDatabase();
  try {
    await seedDemoFacilities(store.db);

    await expect(
      store.db
        .update(facilities)
        .set({ nwpsGaugeId: LOWERCASE_GAUGE_ID })
        .where(eq(facilities.id, SEEDED_FACILITY_ID))
        .execute(),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining(
          "CHECK constraint failed: facilities_nwps_gauge_id_format",
        ),
      },
    });
  } finally {
    store.close();
  }
});

it("rejects an employee assigned to a building that does not exist", async () => {
  const store = await createTestDatabase();
  try {
    await expect(
      store.db
        .insert(employees)
        .values({
          assignedBuildingId: MISSING_BUILDING_ID,
          name: "Nobody",
          email: "nobody@usda.example",
          preferredChannel: "email",
          essentialPersonnel: false,
          teleworkEligible: true,
        })
        .execute(),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining("FOREIGN KEY constraint failed"),
      },
    });
  } finally {
    store.close();
  }
});

it("rejects a status event effective at hour 24", async () => {
  const store = await createTestDatabase();
  try {
    await seedDemoFacilities(store.db);

    await expect(
      store.db
        .insert(employeeStatusEvents)
        .values({
          employeeId: SEEDED_EMPLOYEE_ID,
          status: "teleworking",
          reportedById: SEEDED_DECISION_MAKER_ID,
          reportedAt: REPORTED_AT,
          effectiveFrom: HOUR_24_INSTANT,
        })
        .execute(),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining(
          "CHECK constraint failed: employee_status_events_effective_from_format",
        ),
      },
    });
  } finally {
    store.close();
  }
});

it("rejects a not_working status event whose note is blank", async () => {
  const store = await createTestDatabase();
  try {
    await seedDemoFacilities(store.db);

    await expect(
      store.db
        .insert(employeeStatusEvents)
        .values({
          employeeId: SEEDED_EMPLOYEE_ID,
          status: "not_working",
          note: BLANK_NOTE,
          reportedById: SEEDED_DECISION_MAKER_ID,
          reportedAt: REPORTED_AT,
          effectiveFrom: REPORTED_AT,
        })
        .execute(),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining(
          "CHECK constraint failed: employee_status_events_not_working_requires_note",
        ),
      },
    });
  } finally {
    store.close();
  }
});
