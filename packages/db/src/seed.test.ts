import { count, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  buildingRosterEntries,
  buildings,
  decisionMakers,
  employeeStatusEvents,
  employees,
  facilities,
  facilityHazards,
  tasks,
} from "./schema";
import { DEMO_TASK_ID, seedDemoFacilities, seedDemoTasks } from "./seed";
import { createTestDatabase } from "./testing";

const EDITED_TITLE = "Renamed by a collaborator";
const EDITED_FACILITY_ID = 1;
const EDITED_FACILITY_NAME = "Renamed Service Center";
const SEEDED_EMPLOYEE_COUNT = 29;

it("preserves an edited demo task when the seed runs again", async () => {
  const store = await createTestDatabase();
  try {
    await seedDemoTasks(store.db);
    await store.db
      .update(tasks)
      .set({ title: EDITED_TITLE })
      .where(eq(tasks.id, DEMO_TASK_ID));

    await seedDemoTasks(store.db);

    expect(await store.db.select().from(tasks)).toEqual([
      { id: DEMO_TASK_ID, title: EDITED_TITLE, completed: false },
    ]);
  } finally {
    store.close();
  }
});

it("preserves an edited demo facility when the seed runs again", async () => {
  const store = await createTestDatabase();
  try {
    await seedDemoFacilities(store.db);
    await store.db
      .update(facilities)
      .set({ name: EDITED_FACILITY_NAME })
      .where(eq(facilities.id, EDITED_FACILITY_ID));

    await seedDemoFacilities(store.db);

    expect(
      await store.db
        .select({ id: facilities.id, name: facilities.name })
        .from(facilities)
        .orderBy(facilities.id),
    ).toEqual([
      { id: 1, name: EDITED_FACILITY_NAME },
      { id: 2, name: "Fargo Service Center" },
      { id: 3, name: "Yakima Service Center" },
      { id: 4, name: "Lafayette Service Center" },
    ]);
  } finally {
    store.close();
  }
});

it("adds no rows when the facility seed runs a second time", async () => {
  const store = await createTestDatabase();
  try {
    await seedDemoFacilities(store.db);
    await seedDemoFacilities(store.db);

    expect({
      decisionMakers: await store.db.$count(decisionMakers),
      facilities: await store.db.$count(facilities),
      facilityHazards: await store.db.$count(facilityHazards),
      buildings: await store.db.$count(buildings),
      employees: await store.db.$count(employees),
      buildingRosterEntries: await store.db.$count(buildingRosterEntries),
      employeeStatusEvents: await store.db.$count(employeeStatusEvents),
    }).toEqual({
      decisionMakers: 5,
      facilities: 4,
      facilityHazards: 8,
      buildings: 6,
      employees: 29,
      buildingRosterEntries: 29,
      employeeStatusEvents: 29,
    });
  } finally {
    store.close();
  }
});

it("gives every seeded employee exactly one status event", async () => {
  const store = await createTestDatabase();
  try {
    await seedDemoFacilities(store.db);

    const eventsPerEmployee = await store.db
      .select({ events: count(employeeStatusEvents.id) })
      .from(employees)
      .leftJoin(
        employeeStatusEvents,
        eq(employeeStatusEvents.employeeId, employees.id),
      )
      .groupBy(employees.id);

    expect(eventsPerEmployee.map(({ events }) => events)).toEqual(
      Array.from({ length: SEEDED_EMPLOYEE_COUNT }, () => 1),
    );
  } finally {
    store.close();
  }
});
