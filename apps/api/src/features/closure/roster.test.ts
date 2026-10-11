import {
  buildingRosterEntries,
  buildings,
  employeeStatusEvents,
  employees,
} from "@hackmidwest/db";
import {
  createTestDatabaseWithDemoFacilities,
  DEMO_ROSTER_CASES,
} from "@hackmidwest/db/testing";
import { eq, inArray } from "drizzle-orm";
import { expect, it } from "vitest";
import type { EffectiveStatusKind, FacilityPosture } from "./effective-status";
import {
  type NotifyReason,
  type RosterMatch,
  type RosterReconciliation,
  reconcileRoster,
  type SkipReason,
} from "./roster";

const NOW = "2026-10-12T11:00:00.000Z";
const KANSAS_CITY_FACILITY_ID = 1;
const ANNEX_ID = 2;
const FULL_CLOSURE: FacilityPosture = { posture: "full_closure" };

interface Placement {
  readonly bucket: "notify" | "skip";
  readonly reason: NotifyReason | SkipReason;
  readonly effective: EffectiveStatusKind;
  readonly roster: RosterMatch["kind"];
}

async function reconcileKansasCity(
  posture: FacilityPosture,
): Promise<RosterReconciliation> {
  const store = await createTestDatabaseWithDemoFacilities();
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
      directives: [],
      now: NOW,
    });
  } finally {
    store.close();
  }
}

function placementOf(
  { notify, skip: skipLines }: RosterReconciliation,
  employeeId: number,
): Placement | null {
  const notified = notify.find(({ employee }) => employee.id === employeeId);
  if (notified !== undefined) {
    return {
      bucket: "notify",
      reason: notified.reason,
      effective: notified.status.effective.kind,
      roster: notified.roster.kind,
    };
  }
  const skipped = skipLines.find(({ employee }) => employee.id === employeeId);
  if (skipped !== undefined) {
    return {
      bucket: "skip",
      reason: skipped.reason,
      effective: skipped.status.effective.kind,
      roster: skipped.roster.kind,
    };
  }
  return null;
}

it.each<[string, number, Placement]>([
  [
    "main office essential",
    DEMO_ROSTER_CASES.essentialMainOfficeEmployeeId,
    {
      bucket: "notify",
      reason: "status_changes",
      effective: "report_required",
      roster: "matched",
    },
  ],
  [
    "equipment barn essential",
    DEMO_ROSTER_CASES.essentialEquipmentBarnEmployeeId,
    {
      bucket: "notify",
      reason: "status_changes",
      effective: "report_required",
      roster: "matched",
    },
  ],
  [
    "already teleworking",
    DEMO_ROSTER_CASES.alreadyTeleworkingEmployeeId,
    {
      bucket: "skip",
      reason: "already_teleworking",
      effective: "teleworking",
      roster: "matched",
    },
  ],
  [
    "on detail",
    DEMO_ROSTER_CASES.onDetailEmployeeId,
    {
      bucket: "skip",
      reason: "not_working",
      effective: "not_working",
      roster: "matched",
    },
  ],
  [
    "on leave",
    DEMO_ROSTER_CASES.onLeaveEmployeeId,
    {
      bucket: "skip",
      reason: "not_working",
      effective: "not_working",
      roster: "matched",
    },
  ],
  [
    "accessibility needs",
    DEMO_ROSTER_CASES.accessibilityNeedsEmployeeId,
    {
      bucket: "notify",
      reason: "status_changes",
      effective: "teleworking",
      roster: "matched",
    },
  ],
  [
    "unrostered",
    DEMO_ROSTER_CASES.unrosteredEmployeeId,
    {
      bucket: "notify",
      reason: "status_changes",
      effective: "teleworking",
      roster: "unrostered",
    },
  ],
  [
    "misfiled",
    DEMO_ROSTER_CASES.misfiledEmployeeId,
    {
      bucket: "notify",
      reason: "status_changes",
      effective: "teleworking",
      roster: "misfiled",
    },
  ],
])(
  "places the seeded %s employee under full closure",
  async (_name, employeeId, expected) => {
    const result = await reconcileKansasCity(FULL_CLOSURE);

    expect(placementOf(result, employeeId)).toEqual(expected);
  },
);

it("tells the seeded on-detail and on-leave employees apart by their notes", async () => {
  const { skip: skipLines } = await reconcileKansasCity(FULL_CLOSURE);

  const notes = [
    DEMO_ROSTER_CASES.onDetailEmployeeId,
    DEMO_ROSTER_CASES.onLeaveEmployeeId,
  ].map(
    (id) =>
      skipLines.find(({ employee }) => employee.id === id)?.status.effective,
  );

  expect(notes).toEqual([
    expect.objectContaining({
      kind: "not_working",
      note: "On detail to the state office through October 31.",
    }),
    expect.objectContaining({
      kind: "not_working",
      note: "On annual leave through October 16.",
    }),
  ]);
});

it("points the seeded misfiled employee at their Annex roster entry", async () => {
  const { notify } = await reconcileKansasCity(FULL_CLOSURE);

  const misfiled = notify.find(
    ({ employee }) => employee.id === DEMO_ROSTER_CASES.misfiledEmployeeId,
  );

  expect(misfiled?.roster).toEqual({
    kind: "misfiled",
    entries: [
      {
        id: DEMO_ROSTER_CASES.misfiledEmployeeId,
        buildingId: ANNEX_ID,
        listedName: "Mateo Alvarez",
        employeeId: DEMO_ROSTER_CASES.misfiledEmployeeId,
      },
    ],
  });
});

it("lists the seeded roster-only entry as not in HR", async () => {
  const { unmatched } = await reconcileKansasCity(FULL_CLOSURE);

  expect(unmatched).toEqual([
    {
      entry: {
        id: DEMO_ROSTER_CASES.notInHrRosterEntryId,
        buildingId: ANNEX_ID,
        listedName: "Victor Lindgren",
        employeeId: null,
      },
      reason: "not_in_hr",
    },
  ]);
});

it("carries the seeded accessibility needs on the notify line for routing", async () => {
  const { notify } = await reconcileKansasCity(FULL_CLOSURE);

  const line = notify.find(
    ({ employee }) =>
      employee.id === DEMO_ROSTER_CASES.accessibilityNeedsEmployeeId,
  );

  expect(line?.employee.accessibilityNeeds).toBe(
    "Uses a wheelchair; needs a cleared accessible entrance and parking.",
  );
});

it("announces the open office to the seeded onsite-only employees under unscheduled telework", async () => {
  const { notify } = await reconcileKansasCity({
    posture: "unscheduled_telework",
  });

  const announced = notify
    .filter(({ reason }) => reason === "posture_announcement")
    .map(({ employee }) => employee.name);

  expect(announced).toEqual(["Elliot Brandt", "Isaac Thorne", "Quinn Hartley"]);
});

it("skips an onsite seeded employee as no_change under normal operations", async () => {
  const result = await reconcileKansasCity({ posture: "normal" });

  expect(
    placementOf(result, DEMO_ROSTER_CASES.accessibilityNeedsEmployeeId),
  ).toEqual({
    bucket: "skip",
    reason: "no_change",
    effective: "working_onsite",
    roster: "matched",
  });
});
