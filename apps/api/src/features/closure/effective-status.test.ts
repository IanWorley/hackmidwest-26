import { expect, it } from "vitest";
import type { StatusEvent } from "./baseline";
import type { Directive } from "./directives";
import {
  type EmployeeFacts,
  effectiveStatus,
  type FacilityPosture,
  type PersonnelStatus,
} from "./effective-status";

const NOW = "2026-10-12T11:00:00.000Z";
const SEED_INSTANT = "2026-10-01T12:00:00.000Z";
const RELEASE_AT = "2026-10-12T19:00:00.000Z";
const EARLIER_RELEASE_AT = "2026-10-12T17:30:00.000Z";
const DELAY_MINUTES = 120;
const MAIN_OFFICE_ID = 1;
const MANAGER_ID = 1;
const LEAVE_NOTE = "On annual leave through October 16.";

const NORMAL: FacilityPosture = { posture: "normal" };
const DELAYED_ARRIVAL: FacilityPosture = {
  posture: "delayed_arrival",
  delayMinutes: DELAY_MINUTES,
};
const EARLY_DISMISSAL: FacilityPosture = {
  posture: "early_dismissal",
  releaseAt: RELEASE_AT,
};
const UNSCHEDULED_TELEWORK: FacilityPosture = {
  posture: "unscheduled_telework",
};
const FULL_CLOSURE: FacilityPosture = { posture: "full_closure" };

const ONSITE_ELIGIBLE: EmployeeFacts = {
  id: 1,
  assignedBuildingId: MAIN_OFFICE_ID,
  essentialPersonnel: false,
  teleworkEligible: true,
};
const ESSENTIAL: EmployeeFacts = {
  id: 2,
  assignedBuildingId: MAIN_OFFICE_ID,
  essentialPersonnel: true,
  teleworkEligible: false,
};
const ONSITE_ONLY: EmployeeFacts = {
  id: 3,
  assignedBuildingId: MAIN_OFFICE_ID,
  essentialPersonnel: false,
  teleworkEligible: false,
};
const TELEWORKER: EmployeeFacts = { ...ONSITE_ELIGIBLE, id: 4 };
const LONG_COMMUTER: EmployeeFacts = { ...ONSITE_ELIGIBLE, id: 5 };

function directive(
  fields: Pick<Directive, "id" | "scope" | "directive"> & Partial<Directive>,
): Directive {
  return {
    effectiveAt: null,
    reasonCategory: "weather",
    reasonText: "Ice on the access road.",
    issuedById: MANAGER_ID,
    issuedAt: "2026-10-12T10:00:00.000Z",
    ...fields,
  };
}

function statusEvent(
  fields: Pick<StatusEvent, "id" | "employeeId" | "status"> &
    Partial<StatusEvent>,
): StatusEvent {
  return {
    note: null,
    reportedById: MANAGER_ID,
    reportedAt: SEED_INSTANT,
    effectiveFrom: SEED_INSTANT,
    ...fields,
  };
}

function statusOf(
  employee: EmployeeFacts,
  posture: FacilityPosture,
  options: {
    readonly directives?: readonly Directive[];
    readonly statusEvents?: readonly StatusEvent[];
  } = {},
): PersonnelStatus {
  return effectiveStatus({
    employee,
    posture,
    directives: options.directives ?? [],
    statusEvents: options.statusEvents ?? [],
    now: NOW,
  });
}

it("applies the #41 early-dismissal example to four employees", () => {
  const teleworking = statusEvent({
    id: 1,
    employeeId: TELEWORKER.id,
    status: "teleworking",
  });
  const essentialRemain = directive({
    id: 1,
    scope: { kind: "group", group: "essential" },
    directive: "report",
  });
  const earlierRelease = directive({
    id: 2,
    scope: { kind: "employee", employeeId: LONG_COMMUTER.id },
    directive: "dismissed",
    effectiveAt: EARLIER_RELEASE_AT,
  });
  const options = {
    directives: [essentialRemain, earlierRelease],
    statusEvents: [teleworking],
  };

  const effective = [ONSITE_ELIGIBLE, TELEWORKER, ESSENTIAL, LONG_COMMUTER].map(
    (employee) => statusOf(employee, EARLY_DISMISSAL, options).effective,
  );

  expect(effective).toEqual([
    {
      kind: "dismissed",
      release: { at: RELEASE_AT },
      cause: { source: "posture", posture: "early_dismissal" },
    },
    {
      kind: "teleworking",
      cause: {
        source: "baseline",
        baseline: { status: "teleworking", event: teleworking },
      },
    },
    {
      kind: "report_required",
      cause: { source: "directive", directive: essentialRemain },
    },
    {
      kind: "dismissed",
      release: { at: EARLIER_RELEASE_AT },
      cause: { source: "directive", directive: earlierRelease },
    },
  ]);
});

it.each([
  [NORMAL, "essential", ESSENTIAL, { kind: "working_onsite" }],
  [NORMAL, "telework-eligible", ONSITE_ELIGIBLE, { kind: "working_onsite" }],
  [NORMAL, "onsite-only", ONSITE_ONLY, { kind: "working_onsite" }],
  [DELAYED_ARRIVAL, "essential", ESSENTIAL, { kind: "report_required" }],
  [
    DELAYED_ARRIVAL,
    "telework-eligible",
    ONSITE_ELIGIBLE,
    { kind: "delayed_arrival", delayMinutes: DELAY_MINUTES },
  ],
  [
    DELAYED_ARRIVAL,
    "onsite-only",
    ONSITE_ONLY,
    { kind: "delayed_arrival", delayMinutes: DELAY_MINUTES },
  ],
  [EARLY_DISMISSAL, "essential", ESSENTIAL, { kind: "report_required" }],
  [
    EARLY_DISMISSAL,
    "telework-eligible",
    ONSITE_ELIGIBLE,
    { kind: "dismissed", release: { at: RELEASE_AT } },
  ],
  [
    EARLY_DISMISSAL,
    "onsite-only",
    ONSITE_ONLY,
    { kind: "dismissed", release: { at: RELEASE_AT } },
  ],
  [UNSCHEDULED_TELEWORK, "essential", ESSENTIAL, { kind: "report_required" }],
  [
    UNSCHEDULED_TELEWORK,
    "telework-eligible",
    ONSITE_ELIGIBLE,
    { kind: "teleworking" },
  ],
  [
    UNSCHEDULED_TELEWORK,
    "onsite-only",
    ONSITE_ONLY,
    { kind: "working_onsite" },
  ],
  [FULL_CLOSURE, "essential", ESSENTIAL, { kind: "report_required" }],
  [FULL_CLOSURE, "telework-eligible", ONSITE_ELIGIBLE, { kind: "teleworking" }],
  [
    FULL_CLOSURE,
    "onsite-only",
    ONSITE_ONLY,
    { kind: "dismissed", release: "all_day" },
  ],
])("maps %o for a %s employee", (posture, _role, employee, expected) => {
  expect(statusOf(employee, posture).effective).toEqual({
    ...expected,
    cause: expect.anything(),
  });
});

it("does not move a not_working employee with a facility-wide directive", () => {
  const leave = statusEvent({
    id: 1,
    employeeId: ONSITE_ELIGIBLE.id,
    status: "not_working",
    note: LEAVE_NOTE,
  });
  const everyoneReport = directive({
    id: 1,
    scope: { kind: "facility" },
    directive: "report",
  });

  const { effective } = statusOf(ONSITE_ELIGIBLE, FULL_CLOSURE, {
    directives: [everyoneReport],
    statusEvents: [leave],
  });

  expect(effective).toEqual({
    kind: "not_working",
    note: LEAVE_NOTE,
    cause: {
      source: "baseline",
      baseline: { status: "not_working", note: LEAVE_NOTE, event: leave },
    },
  });
});

it.each([
  [EARLIER_RELEASE_AT, EARLY_DISMISSAL, { at: EARLIER_RELEASE_AT }],
  [null, EARLY_DISMISSAL, { at: RELEASE_AT }],
  [null, FULL_CLOSURE, "all_day"],
])(
  "releases a dismissal with directive time %s under %o at %o",
  (effectiveAt, posture, release) => {
    const dismissed = directive({
      id: 1,
      scope: { kind: "employee", employeeId: ESSENTIAL.id },
      directive: "dismissed",
      effectiveAt,
    });

    const { effective } = statusOf(ESSENTIAL, posture, {
      directives: [dismissed],
    });

    expect(effective).toEqual({
      kind: "dismissed",
      release,
      cause: { source: "directive", directive: dismissed },
    });
  },
);
