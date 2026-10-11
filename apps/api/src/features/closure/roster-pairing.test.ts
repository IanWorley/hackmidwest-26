import { expect, it } from "vitest";
import type { Directive } from "./directives";
import type { Employee, FacilityPosture } from "./effective-status";
import { type RosterEntry, reconcileRoster } from "./roster";

const NOW = "2026-10-12T11:00:00.000Z";
const MAIN_OFFICE_ID = 1;
const ANNEX_ID = 2;
const FARGO_EMPLOYEE_ID = 21;
const FULL_CLOSURE: FacilityPosture = { posture: "full_closure" };
const MANAGER_ID = 1;
const SEED_INSTANT = "2026-10-01T12:00:00.000Z";

const EMPLOYEE: Employee = {
  id: 1,
  assignedBuildingId: MAIN_OFFICE_ID,
  name: "Avery Calloway",
  email: "avery.calloway@example.gov",
  mobilePhone: null,
  preferredChannel: "email",
  essentialPersonnel: false,
  teleworkEligible: true,
  accessibilityNeeds: null,
  shiftStart: null,
  shiftEnd: null,
  commuteMinutes: null,
};

it("lists a roster entry for someone HR assigns to another facility as assigned elsewhere", () => {
  const staleEntry: RosterEntry = {
    id: 1,
    buildingId: MAIN_OFFICE_ID,
    listedName: "Uma Sorensen",
    employeeId: FARGO_EMPLOYEE_ID,
  };

  const { unmatched } = reconcileRoster({
    employees: [],
    rosterEntries: [staleEntry],
    statusEvents: [],
    posture: FULL_CLOSURE,
    directives: [],
    now: NOW,
  });

  expect(unmatched).toEqual([
    { entry: staleEntry, reason: "assigned_elsewhere" },
  ]);
});

it("keeps a second listing in another building on a matched employee", () => {
  const ownEntry: RosterEntry = {
    id: 1,
    buildingId: MAIN_OFFICE_ID,
    listedName: EMPLOYEE.name,
    employeeId: EMPLOYEE.id,
  };
  const staleEntry: RosterEntry = { ...ownEntry, id: 2, buildingId: ANNEX_ID };

  const { notify } = reconcileRoster({
    employees: [EMPLOYEE],
    rosterEntries: [staleEntry, ownEntry],
    statusEvents: [],
    posture: FULL_CLOSURE,
    directives: [],
    now: NOW,
  });

  expect(notify.map(({ roster }) => roster)).toEqual([
    { kind: "matched", entry: ownEntry, alsoListed: [staleEntry] },
  ]);
});

it("notifies someone not working when a directive names them, even though they stay not working", () => {
  const excused: Directive = {
    id: 1,
    scope: { kind: "employee", employeeId: EMPLOYEE.id },
    directive: "excused",
    effectiveAt: null,
    reasonCategory: "weather",
    reasonText: "Stay home; your detail office is closed too.",
    issuedById: MANAGER_ID,
    issuedAt: SEED_INSTANT,
  };

  const { notify } = reconcileRoster({
    employees: [EMPLOYEE],
    rosterEntries: [],
    statusEvents: [
      {
        id: 1,
        employeeId: EMPLOYEE.id,
        status: "not_working",
        note: "On detail to the state office through October 31.",
        reportedById: MANAGER_ID,
        reportedAt: SEED_INSTANT,
        effectiveFrom: SEED_INSTANT,
      },
    ],
    posture: FULL_CLOSURE,
    directives: [excused],
    now: NOW,
  });

  expect(
    notify.map(({ reason, status }) => [reason, status.effective]),
  ).toEqual([
    [
      "directive_issued",
      {
        kind: "not_working",
        note: "Stay home; your detail office is closed too.",
        cause: { source: "directive", directive: excused },
      },
    ],
  ]);
});
