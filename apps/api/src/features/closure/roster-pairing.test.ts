import { expect, it } from "vitest";
import type { Employee, FacilityPosture } from "./effective-status";
import { type RosterEntry, reconcileRoster } from "./roster";

const NOW = "2026-10-12T11:00:00.000Z";
const MAIN_OFFICE_ID = 1;
const ANNEX_ID = 2;
const FARGO_EMPLOYEE_ID = 21;
const FULL_CLOSURE: FacilityPosture = { posture: "full_closure" };

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
  const employee: Employee = {
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
  const ownEntry: RosterEntry = {
    id: 1,
    buildingId: MAIN_OFFICE_ID,
    listedName: employee.name,
    employeeId: employee.id,
  };
  const staleEntry: RosterEntry = { ...ownEntry, id: 2, buildingId: ANNEX_ID };

  const { notify } = reconcileRoster({
    employees: [employee],
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
