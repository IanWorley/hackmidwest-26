import {
  buildingRosterEntries,
  buildings,
  employeeStatusEvents,
  employees,
} from "@hackmidwest/db";
import type { DatabaseStore } from "@hackmidwest/db/connection";
import { eq, inArray } from "drizzle-orm";
import type { Directive } from "./directives";
import type { FacilityPosture } from "./effective-status";
import { type RosterReconciliation, reconcileRoster } from "./roster";

const NOW = "2026-10-12T11:00:00.000Z";
const KANSAS_CITY_FACILITY_ID = 1;

/** The seeded Kansas City facility's HR employees, roster, and status events, reconciled at NOW. */
async function reconcileKansasCityOn(
  openStore: () => Promise<DatabaseStore>,
  posture: FacilityPosture,
  directives: readonly Directive[] = [],
): Promise<RosterReconciliation> {
  const store = await openStore();
  try {
    const facilityBuildings = store.db
      .select({ id: buildings.id })
      .from(buildings)
      .where(eq(buildings.facilityId, KANSAS_CITY_FACILITY_ID));
    return reconcileRoster({
      employees: await store.db
        .select()
        .from(employees)
        .where(inArray(employees.assignedBuildingId, facilityBuildings)),
      rosterEntries: await store.db
        .select()
        .from(buildingRosterEntries)
        .where(inArray(buildingRosterEntries.buildingId, facilityBuildings)),
      statusEvents: await store.db.select().from(employeeStatusEvents),
      posture,
      directives,
      now: NOW,
    });
  } finally {
    store.close();
  }
}

export { reconcileKansasCityOn };
