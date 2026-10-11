import { expect, it } from "vitest";
import { type Directive, winningDirective } from "./directives";

const NOW = "2026-10-12T11:00:00.000Z";
const AFTER_NOW = "2026-10-12T12:00:00.000Z";
const MAIN_OFFICE_ID = 1;
const MANAGER_ID = 1;

const ESSENTIAL = {
  id: 2,
  assignedBuildingId: MAIN_OFFICE_ID,
  essentialPersonnel: true,
};

function directive(
  fields: Pick<Directive, "id" | "scope" | "directive"> & Partial<Directive>,
): Directive {
  return {
    effectiveAt: null,
    reasonCategory: "local_conditions",
    reasonText: "Ice on the access road.",
    issuedById: MANAGER_ID,
    issuedAt: "2026-10-12T10:00:00.000Z",
    ...fields,
  };
}

const FACILITY_DISMISSED = directive({
  id: 1,
  scope: { kind: "facility" },
  directive: "dismissed",
  issuedAt: "2026-10-12T04:00:00.000Z",
});
const ESSENTIAL_REPORT = directive({
  id: 2,
  scope: { kind: "group", group: "essential" },
  directive: "report",
  issuedAt: "2026-10-12T03:00:00.000Z",
});
const BUILDING_TELEWORK = directive({
  id: 3,
  scope: { kind: "building", buildingId: MAIN_OFFICE_ID },
  directive: "telework",
  issuedAt: "2026-10-12T02:00:00.000Z",
});
const EMPLOYEE_EXCUSED = directive({
  id: 4,
  scope: { kind: "employee", employeeId: ESSENTIAL.id },
  directive: "excused",
  issuedAt: "2026-10-12T01:00:00.000Z",
});

it.each([
  [FACILITY_DISMISSED, []],
  [ESSENTIAL_REPORT, [FACILITY_DISMISSED]],
  [BUILDING_TELEWORK, [FACILITY_DISMISSED, ESSENTIAL_REPORT]],
  [EMPLOYEE_EXCUSED, [FACILITY_DISMISSED, ESSENTIAL_REPORT, BUILDING_TELEWORK]],
])(
  "lets directive %o beat every less specific one, even one issued later",
  (expected, lessSpecific) => {
    expect(
      winningDirective(ESSENTIAL, true, [...lessSpecific, expected], NOW),
    ).toBe(expected);
  },
);

it("prefers the later of two directives with equal specificity", () => {
  const later = directive({
    id: 1,
    scope: { kind: "facility" },
    directive: "telework",
    issuedAt: "2026-10-12T10:30:00.000Z",
  });
  const earlier = directive({
    id: 2,
    scope: { kind: "facility" },
    directive: "report",
    issuedAt: "2026-10-12T10:00:00.000Z",
  });

  expect(winningDirective(ESSENTIAL, true, [later, earlier], NOW)).toBe(later);
});

it("breaks a tie of equal specificity and issuedAt toward the higher id", () => {
  const lower = directive({
    id: 1,
    scope: { kind: "facility" },
    directive: "telework",
  });
  const higher = directive({
    id: 2,
    scope: { kind: "facility" },
    directive: "report",
  });

  expect([
    winningDirective(ESSENTIAL, true, [lower, higher], NOW),
    winningDirective(ESSENTIAL, true, [higher, lower], NOW),
  ]).toEqual([higher, higher]);
});

it("ignores a directive issued after now", () => {
  const issued = directive({
    id: 1,
    scope: { kind: "facility" },
    directive: "report",
  });
  const notYetIssued = directive({
    id: 2,
    scope: { kind: "employee", employeeId: ESSENTIAL.id },
    directive: "telework",
    issuedAt: AFTER_NOW,
  });

  expect(winningDirective(ESSENTIAL, true, [issued, notYetIssued], NOW)).toBe(
    issued,
  );
});

it("reaches someone off the facility's schedule only with an employee-scoped directive", () => {
  const broad = [FACILITY_DISMISSED, ESSENTIAL_REPORT, BUILDING_TELEWORK];

  expect([
    winningDirective(ESSENTIAL, false, broad, NOW),
    winningDirective(ESSENTIAL, false, [...broad, EMPLOYEE_EXCUSED], NOW),
  ]).toEqual([null, EMPLOYEE_EXCUSED]);
});
