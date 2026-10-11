import type { EmployeeStatus } from "@hackmidwest/db";
import type { StatusEvent } from "./baseline";
import type { Directive, DirectiveKind, DirectiveScope } from "./directives";
import type { Employee, FacilityPosture } from "./effective-status";
import {
  buildNotificationPackage,
  type DecidedPackage,
  type NotificationPackageInput,
} from "./notifications";
import { contentHash } from "./records";

type DecidedSource = DecidedPackage["source"];
type PackageFields = Partial<NotificationPackageInput<DecidedSource>>;

const DECIDED: DecidedSource = {
  kind: "decided",
  decision: { decisionId: 7, decisionHash: contentHash({ decisionId: 7 }) },
};
const SUPERSEDING: DecidedSource = {
  kind: "decided",
  decision: { decisionId: 8, decisionHash: contentHash({ decisionId: 8 }) },
};
const FULL_CLOSURE: FacilityPosture = { posture: "full_closure" };
const NORMAL: FacilityPosture = { posture: "normal" };
const PHONE = "+18165550111";
// 2026-10-12 is CDT (UTC-5): the 06:30 arrival window opens at 11:30Z, and a
// default employee's sendBy is 06:30 − 35 min commute − 60 min lead = 09:55Z.
const NOW = "2026-10-12T05:00:00.000Z";
const DEFAULT_SEND_BY = "2026-10-12T09:55:00.000Z";
const AFTER_DEFAULT_SEND_BY = "2026-10-12T10:00:00.000Z";
const AT_WORK = "2026-10-12T12:00:00.000Z";
const RELEASE_AFTER_START = "2026-10-12T19:00:00.000Z";
const ARRIVAL_WINDOW_START = "2026-10-12T11:30:00.000Z";
const FACILITY_NAME = "Kansas City Area Service Center";
const FACILITY: NotificationPackageInput["facility"] = {
  name: FACILITY_NAME,
  timezone: "America/Chicago",
  arrivalWindowStart: "06:30",
  typicalCommuteMinutes: 35,
  notificationLeadMinutes: 60,
};

function employee(fields: Pick<Employee, "id"> & Partial<Employee>): Employee {
  return {
    assignedBuildingId: 1,
    name: `Employee ${fields.id}`,
    email: `employee${fields.id}@example.gov`,
    mobilePhone: null,
    preferredChannel: "email",
    essentialPersonnel: false,
    teleworkEligible: true,
    accessibilityNeeds: null,
    shiftStart: null,
    shiftEnd: null,
    commuteMinutes: null,
    ...fields,
  };
}

function directive(
  kind: DirectiveKind,
  scope: DirectiveScope = { kind: "employee", employeeId: 1 },
  effectiveAt: string | null = null,
): Directive {
  return {
    id: 1,
    scope,
    directive: kind,
    effectiveAt,
    reasonCategory: "road_reports",
    reasonText: "Ice on the access road.",
    issuedById: 1,
    issuedAt: "2026-10-12T04:00:00.000Z",
  };
}

function dismissedAt(effectiveAt: string): Directive {
  return directive("dismissed", undefined, effectiveAt);
}

function statusSince(
  employeeId: number,
  status: EmployeeStatus,
  at: string,
): StatusEvent {
  return {
    id: employeeId,
    employeeId,
    status,
    note: "On approved leave.",
    reportedById: 1,
    reportedAt: at,
    effectiveFrom: at,
  };
}

/** One telework-eligible employee under a full closure, decided before anyone's sendBy. */
function packageInput(
  fields: PackageFields,
): NotificationPackageInput<DecidedSource> {
  return {
    source: DECIDED,
    employees: [employee({ id: 1 })],
    rosterEntries: [],
    statusEvents: [],
    posture: FULL_CLOSURE,
    directives: [],
    now: NOW,
    facility: FACILITY,
    facilityDate: "2026-10-12",
    hazard: {
      kind: "winter",
      start: "2026-10-12T09:00:00.000Z",
      end: "2026-10-12T16:00:00.000Z",
    },
    urgency: "Expected",
    ...fields,
  };
}

function decidedPackage(fields: PackageFields): DecidedPackage {
  return buildNotificationPackage(packageInput(fields));
}

export type { PackageFields };
export {
  AFTER_DEFAULT_SEND_BY,
  ARRIVAL_WINDOW_START,
  AT_WORK,
  DECIDED,
  DEFAULT_SEND_BY,
  decidedPackage,
  directive,
  dismissedAt,
  employee,
  FACILITY_NAME,
  NORMAL,
  NOW,
  PHONE,
  packageInput,
  RELEASE_AFTER_START,
  SUPERSEDING,
  statusSince,
};
