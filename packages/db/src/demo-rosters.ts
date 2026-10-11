import {
  type DemoFacility,
  demoEmail,
  FARGO,
  FARGO_MAIN_OFFICE_ID,
  KANSAS_CITY,
  KANSAS_CITY_ANNEX_ID,
  KANSAS_CITY_EQUIPMENT_BARN_ID,
  KANSAS_CITY_MAIN_OFFICE_ID,
  LAFAYETTE,
  LAFAYETTE_MAIN_OFFICE_ID,
  YAKIMA,
  YAKIMA_MAIN_OFFICE_ID,
} from "./demo-facilities";
import type {
  buildingRosterEntries,
  employeeStatusEvents,
  employees,
} from "./schema";

type DemoEmployee = typeof employees.$inferInsert & { readonly id: number };
type EmployeeFixture = Pick<
  DemoEmployee,
  "id" | "assignedBuildingId" | "name"
> &
  Partial<DemoEmployee>;
type DemoStatusEvent = typeof employeeStatusEvents.$inferInsert;

const SEED_INSTANT = "2026-10-01T12:00:00.000Z";

const ESSENTIAL_MAIN_OFFICE_EMPLOYEE_ID = 2;
const ESSENTIAL_EQUIPMENT_BARN_EMPLOYEE_ID = 3;
const ALREADY_TELEWORKING_EMPLOYEE_ID = 4;
const ON_DETAIL_EMPLOYEE_ID = 6;
const ON_LEAVE_EMPLOYEE_ID = 7;
const ACCESSIBILITY_NEEDS_EMPLOYEE_ID = 8;
const UNROSTERED_EMPLOYEE_ID = 12;
const MISFILED_EMPLOYEE_ID = 13;
// Matched roster entries reuse their employee's id; this entry sits above that range.
const NOT_IN_HR_ROSTER_ENTRY_ID = 1000;

/** Everyone is a telework-eligible, non-essential employee reached by email unless their fixture says otherwise. */
function withEmployeeDefaults(
  fixtures: readonly EmployeeFixture[],
): DemoEmployee[] {
  return fixtures.map((fixture) => ({
    email: demoEmail(fixture.name),
    preferredChannel: "email",
    essentialPersonnel: false,
    teleworkEligible: true,
    ...fixture,
  }));
}

// 555-0100 through 555-0199 are reserved for fiction, so no seeded phone rings.
const KANSAS_CITY_EMPLOYEES: DemoEmployee[] = withEmployeeDefaults([
  {
    id: 1,
    assignedBuildingId: KANSAS_CITY_MAIN_OFFICE_ID,
    name: "Avery Calloway",
  },
  {
    id: ESSENTIAL_MAIN_OFFICE_EMPLOYEE_ID,
    assignedBuildingId: KANSAS_CITY_MAIN_OFFICE_ID,
    name: "Bianca Ferraro",
    essentialPersonnel: true,
    teleworkEligible: false,
  },
  {
    id: ESSENTIAL_EQUIPMENT_BARN_EMPLOYEE_ID,
    assignedBuildingId: KANSAS_CITY_EQUIPMENT_BARN_ID,
    name: "Caleb Mendoza",
    essentialPersonnel: true,
    teleworkEligible: false,
    mobilePhone: "+18165550103",
    preferredChannel: "sms",
  },
  {
    id: ALREADY_TELEWORKING_EMPLOYEE_ID,
    assignedBuildingId: KANSAS_CITY_MAIN_OFFICE_ID,
    name: "Delia Okafor",
  },
  {
    id: 5,
    assignedBuildingId: KANSAS_CITY_EQUIPMENT_BARN_ID,
    name: "Elliot Brandt",
    teleworkEligible: false,
  },
  {
    id: ON_DETAIL_EMPLOYEE_ID,
    assignedBuildingId: KANSAS_CITY_MAIN_OFFICE_ID,
    name: "Farah Haddad",
  },
  {
    id: ON_LEAVE_EMPLOYEE_ID,
    assignedBuildingId: KANSAS_CITY_ANNEX_ID,
    name: "Gideon Marsh",
  },
  {
    id: ACCESSIBILITY_NEEDS_EMPLOYEE_ID,
    assignedBuildingId: KANSAS_CITY_MAIN_OFFICE_ID,
    name: "Hana Kowalczyk",
    accessibilityNeeds:
      "Uses a wheelchair; needs a cleared accessible entrance and parking.",
  },
  {
    id: 9,
    assignedBuildingId: KANSAS_CITY_EQUIPMENT_BARN_ID,
    name: "Isaac Thorne",
    teleworkEligible: false,
    shiftStart: "05:30",
    shiftEnd: "14:00",
  },
  {
    id: 10,
    assignedBuildingId: KANSAS_CITY_ANNEX_ID,
    name: "Joelle Baptiste",
    commuteMinutes: 95,
  },
  {
    id: 11,
    assignedBuildingId: KANSAS_CITY_ANNEX_ID,
    name: "Kenji Watanabe",
    mobilePhone: "+18165550111",
    preferredChannel: "sms",
  },
  {
    id: UNROSTERED_EMPLOYEE_ID,
    assignedBuildingId: KANSAS_CITY_MAIN_OFFICE_ID,
    name: "Lena Marchetti",
  },
  {
    id: MISFILED_EMPLOYEE_ID,
    assignedBuildingId: KANSAS_CITY_MAIN_OFFICE_ID,
    name: "Mateo Alvarez",
  },
  { id: 14, assignedBuildingId: KANSAS_CITY_ANNEX_ID, name: "Nadia Petrov" },
  {
    id: 15,
    assignedBuildingId: KANSAS_CITY_MAIN_OFFICE_ID,
    name: "Owen Gallagher",
  },
  { id: 16, assignedBuildingId: KANSAS_CITY_ANNEX_ID, name: "Paloma Reyes" },
  {
    id: 17,
    assignedBuildingId: KANSAS_CITY_EQUIPMENT_BARN_ID,
    name: "Quinn Hartley",
    teleworkEligible: false,
  },
  {
    id: 18,
    assignedBuildingId: KANSAS_CITY_MAIN_OFFICE_ID,
    name: "Rosa Delgado",
  },
  {
    id: 19,
    assignedBuildingId: KANSAS_CITY_ANNEX_ID,
    name: "Silas Montgomery",
  },
  {
    id: 20,
    assignedBuildingId: KANSAS_CITY_MAIN_OFFICE_ID,
    name: "Tessa Nguyen",
  },
]);

const FARGO_EMPLOYEES: DemoEmployee[] = withEmployeeDefaults([
  { id: 21, assignedBuildingId: FARGO_MAIN_OFFICE_ID, name: "Uma Sorensen" },
  {
    id: 22,
    assignedBuildingId: FARGO_MAIN_OFFICE_ID,
    name: "Walt Hagen",
    teleworkEligible: false,
  },
  { id: 23, assignedBuildingId: FARGO_MAIN_OFFICE_ID, name: "Xenia Larsen" },
]);

const YAKIMA_EMPLOYEES: DemoEmployee[] = withEmployeeDefaults([
  { id: 24, assignedBuildingId: YAKIMA_MAIN_OFFICE_ID, name: "Yusuf Karimi" },
  { id: 25, assignedBuildingId: YAKIMA_MAIN_OFFICE_ID, name: "Zoe Whitaker" },
  {
    id: 26,
    assignedBuildingId: YAKIMA_MAIN_OFFICE_ID,
    name: "Amara Collins",
    teleworkEligible: false,
  },
]);

const LAFAYETTE_EMPLOYEES: DemoEmployee[] = withEmployeeDefaults([
  {
    id: 27,
    assignedBuildingId: LAFAYETTE_MAIN_OFFICE_ID,
    name: "Beau Thibodeaux",
  },
  {
    id: 28,
    assignedBuildingId: LAFAYETTE_MAIN_OFFICE_ID,
    name: "Celeste Guidry",
    teleworkEligible: false,
  },
  {
    id: 29,
    assignedBuildingId: LAFAYETTE_MAIN_OFFICE_ID,
    name: "Dominic Landry",
  },
]);

const DEMO_EMPLOYEES: DemoEmployee[] = [
  ...KANSAS_CITY_EMPLOYEES,
  ...FARGO_EMPLOYEES,
  ...YAKIMA_EMPLOYEES,
  ...LAFAYETTE_EMPLOYEES,
];

const ROSTER_BUILDING_OVERRIDES: ReadonlyMap<number, number> = new Map([
  [MISFILED_EMPLOYEE_ID, KANSAS_CITY_ANNEX_ID],
]);

/** Every employee is on their own building's roster except the disagreements above. */
const DEMO_BUILDING_ROSTER_ENTRIES: (typeof buildingRosterEntries.$inferInsert)[] =
  [
    ...DEMO_EMPLOYEES.filter(({ id }) => id !== UNROSTERED_EMPLOYEE_ID).map(
      ({ id, assignedBuildingId, name }) => ({
        id,
        buildingId: ROSTER_BUILDING_OVERRIDES.get(id) ?? assignedBuildingId,
        listedName: name,
        employeeId: id,
      }),
    ),
    {
      id: NOT_IN_HR_ROSTER_ENTRY_ID,
      buildingId: KANSAS_CITY_ANNEX_ID,
      listedName: "Victor Lindgren",
    },
  ];

const INITIAL_STATUS_OVERRIDES: ReadonlyMap<
  number,
  Pick<DemoStatusEvent, "status" | "note">
> = new Map([
  [ALREADY_TELEWORKING_EMPLOYEE_ID, { status: "teleworking", note: null }],
  [
    ON_DETAIL_EMPLOYEE_ID,
    {
      status: "not_working",
      note: "On detail to the state office through October 31.",
    },
  ],
  [
    ON_LEAVE_EMPLOYEE_ID,
    { status: "not_working", note: "On annual leave through October 16." },
  ],
]);

function initialStatusEvents(
  facility: DemoFacility,
  facilityEmployees: readonly DemoEmployee[],
): DemoStatusEvent[] {
  // One seed event per employee, so the employee id is a stable reserved event id.
  return facilityEmployees.map(({ id }) => ({
    id,
    employeeId: id,
    status: "working_onsite",
    note: null,
    ...INITIAL_STATUS_OVERRIDES.get(id),
    reportedById: facility.decisionMakerId,
    reportedAt: SEED_INSTANT,
    effectiveFrom: SEED_INSTANT,
  }));
}

const DEMO_EMPLOYEE_STATUS_EVENTS: DemoStatusEvent[] = [
  ...initialStatusEvents(KANSAS_CITY, KANSAS_CITY_EMPLOYEES),
  ...initialStatusEvents(FARGO, FARGO_EMPLOYEES),
  ...initialStatusEvents(YAKIMA, YAKIMA_EMPLOYEES),
  ...initialStatusEvents(LAFAYETTE, LAFAYETTE_EMPLOYEES),
];

/** The seeded Kansas City disagreements and special cases, by employee id (or roster entry id where HR has none). */
const DEMO_ROSTER_CASES = {
  essentialMainOfficeEmployeeId: ESSENTIAL_MAIN_OFFICE_EMPLOYEE_ID,
  essentialEquipmentBarnEmployeeId: ESSENTIAL_EQUIPMENT_BARN_EMPLOYEE_ID,
  alreadyTeleworkingEmployeeId: ALREADY_TELEWORKING_EMPLOYEE_ID,
  onDetailEmployeeId: ON_DETAIL_EMPLOYEE_ID,
  onLeaveEmployeeId: ON_LEAVE_EMPLOYEE_ID,
  accessibilityNeedsEmployeeId: ACCESSIBILITY_NEEDS_EMPLOYEE_ID,
  unrosteredEmployeeId: UNROSTERED_EMPLOYEE_ID,
  misfiledEmployeeId: MISFILED_EMPLOYEE_ID,
  notInHrRosterEntryId: NOT_IN_HR_ROSTER_ENTRY_ID,
} as const;

export {
  DEMO_BUILDING_ROSTER_ENTRIES,
  DEMO_EMPLOYEE_STATUS_EVENTS,
  DEMO_EMPLOYEES,
  DEMO_ROSTER_CASES,
};
