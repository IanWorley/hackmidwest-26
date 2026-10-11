import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { employeeStatusEvents, tasks } from "./schema";
import { seedDemoFacilities } from "./seed";
import { createTestDatabase } from "./testing";

const SEEDED_EMPLOYEE_ID = 1;
const SEEDED_DECISION_MAKER_ID = 1;
const REPORTED_AT = "2026-10-02T13:00:00.000Z";
const IMPOSSIBLE_INSTANT = "2026-02-30T13:00:00.000Z";

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
