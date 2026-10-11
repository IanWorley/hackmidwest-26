import type { Database } from "./client";
import {
  DEMO_BUILDINGS,
  DEMO_DECISION_MAKERS,
  DEMO_FACILITIES,
  DEMO_FACILITY_HAZARDS,
} from "./demo-facilities";
import {
  DEMO_BUILDING_ROSTER_ENTRIES,
  DEMO_EMPLOYEE_STATUS_EVENTS,
  DEMO_EMPLOYEES,
} from "./demo-rosters";
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

const DEMO_TASK_ID = 1;
const DEMO_TASK_TITLE = "Build the Hack Midwest demo";

/** A reserved fixture key makes repeat runs preserve collaborators' edits. */
export async function seedDemoTasks(db: Database): Promise<void> {
  await db
    .insert(tasks)
    .values({ id: DEMO_TASK_ID, title: DEMO_TASK_TITLE })
    .onConflictDoNothing({ target: tasks.id });
}

/** Parents insert before children, and the batch is one transaction, so a failed run leaves nothing behind. */
export async function seedDemoFacilities(db: Database): Promise<void> {
  await db.batch([
    db
      .insert(decisionMakers)
      .values(DEMO_DECISION_MAKERS)
      .onConflictDoNothing({ target: decisionMakers.id }),
    db
      .insert(facilities)
      .values(DEMO_FACILITIES)
      .onConflictDoNothing({ target: facilities.id }),
    db
      .insert(facilityHazards)
      .values(DEMO_FACILITY_HAZARDS)
      .onConflictDoNothing({
        target: [facilityHazards.facilityId, facilityHazards.hazard],
      }),
    db
      .insert(buildings)
      .values(DEMO_BUILDINGS)
      .onConflictDoNothing({ target: buildings.id }),
    db
      .insert(employees)
      .values(DEMO_EMPLOYEES)
      .onConflictDoNothing({ target: employees.id }),
    db
      .insert(buildingRosterEntries)
      .values(DEMO_BUILDING_ROSTER_ENTRIES)
      .onConflictDoNothing({ target: buildingRosterEntries.id }),
    db
      .insert(employeeStatusEvents)
      .values(DEMO_EMPLOYEE_STATUS_EVENTS)
      .onConflictDoNothing({ target: employeeStatusEvents.id }),
  ]);
}

export { DEMO_TASK_ID };
