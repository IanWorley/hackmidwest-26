import { expect, expectTypeOf, it } from "vitest";
import type { Directive, DirectiveKind, DirectiveScope } from "./directives";
import type { Employee, FacilityPosture } from "./effective-status";
import {
  buildAllClear,
  buildNotificationPackage,
  buildPostureChangeUpdate,
  type DecidedPackage,
  dispatchTimeline,
  type NotificationPackageInput,
} from "./notifications";
import { contentHash } from "./records";

type DecidedSource = DecidedPackage["source"];

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
const AFTER_DEFAULT_SEND_BY = "2026-10-12T10:00:00.000Z";
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
const OWN_SCHEDULE = {
  shiftStart: "07:00",
  shiftEnd: "15:30",
  commuteMinutes: 50,
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

function decidedPackage(
  fields: Partial<NotificationPackageInput<DecidedSource>>,
): DecidedPackage {
  return buildNotificationPackage(packageInput(fields));
}

/** One telework-eligible employee under a full closure, decided before anyone's sendBy. */
function packageInput(
  fields: Partial<NotificationPackageInput<DecidedSource>>,
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

it.each<[string, Partial<NotificationPackageInput<DecidedSource>>, string]>([
  [
    "the employee's own shift start and commute",
    { employees: [employee({ id: 1, ...OWN_SCHEDULE })] },
    "2026-10-12T10:10:00.000Z",
  ],
  [
    "the facility arrival window and typical commute",
    {},
    "2026-10-12T09:55:00.000Z",
  ],
  [
    "an employee-scoped release after their start, with no commute",
    { posture: NORMAL, directives: [dismissedAt(RELEASE_AFTER_START)] },
    "2026-10-12T18:00:00.000Z",
  ],
  [
    "their commute when the release is at their start",
    { posture: NORMAL, directives: [dismissedAt(ARRIVAL_WINDOW_START)] },
    "2026-10-12T09:55:00.000Z",
  ],
])("counts sendBy back from %s", (_scenario, fields, sendBy) => {
  const pkg = decidedPackage(fields);
  expect(pkg.recipients.map(({ delivery }) => delivery.sendBy)).toEqual([
    sendBy,
  ]);
});

it.each<[string, string | null, string]>([
  ["sms when they have a mobile phone", PHONE, "sms"],
  ["email when they have none", null, "email"],
])("flags a late recipient and routes %s", (_case, mobilePhone, channel) => {
  const pkg = decidedPackage({
    employees: [employee({ id: 1, mobilePhone })],
    now: AFTER_DEFAULT_SEND_BY,
  });
  expect(
    pkg.recipients.map(({ delivery }) => [delivery.late, delivery.channel]),
  ).toEqual([[true, channel]]);
});

it("routes an on-time, email-preferring employee with a phone to sms under Immediate urgency", () => {
  const pkg = decidedPackage({
    employees: [employee({ id: 1, mobilePhone: PHONE })],
    urgency: "Immediate",
  });
  expect(
    pkg.recipients.map(({ delivery }) => [delivery.late, delivery.channel]),
  ).toEqual([[false, "sms"]]);
});

it("excludes an excused employee as excused instead of messaging them", () => {
  const pkg = decidedPackage({ directives: [directive("excused")] });
  expect({
    recipients: pkg.recipients.length,
    exclusions: pkg.exclusions.map(({ kind }) => kind),
  }).toEqual({ recipients: 0, exclusions: ["excused"] });
});

it("tells essential staff to report and dismissed staff to stay home (#41)", () => {
  const pkg = decidedPackage({
    employees: [
      employee({ id: 1, essentialPersonnel: true, teleworkEligible: false }),
      employee({ id: 2, teleworkEligible: false }),
    ],
    directives: [directive("report", { kind: "group", group: "essential" })],
  });
  expect(pkg.recipients.map(({ message }) => message.whatToDo)).toEqual([
    `Report to ${FACILITY_NAME} at 06:30 as usual.`,
    `Do not report to ${FACILITY_NAME} today.`,
  ]);
});

it("names the directive and its reason in appliesToYou", () => {
  const pkg = decidedPackage({
    posture: NORMAL,
    directives: [dismissedAt(RELEASE_AFTER_START)],
  });
  expect(pkg.recipients.map(({ message }) => message.appliesToYou)).toEqual([
    "You are released early at 14:00. A manager issued a directive for you: Ice on the access road.",
  ]);
});

it("sends the new instruction to someone the superseding decision no longer notifies", () => {
  const employees = [employee({ id: 1, teleworkEligible: false })];
  const update = buildPostureChangeUpdate({
    original: decidedPackage({ employees }),
    superseding: decidedPackage({
      employees,
      posture: NORMAL,
      source: SUPERSEDING,
    }),
  });
  expect(
    update.notices.map(({ employee: { id }, message }) => [
      id,
      message.appliesToYou,
      message.whatToDo,
    ]),
  ).toEqual([
    [
      1,
      "This replaces the notice sent for the earlier decision. The office stays open for you.",
      `Report to ${FACILITY_NAME} at 06:30 as usual.`,
    ],
  ]);
});

it("withdraws the earlier notice for someone the superseding decision does not place", () => {
  const update = buildPostureChangeUpdate({
    original: decidedPackage({}),
    superseding: decidedPackage({ employees: [], source: SUPERSEDING }),
  });
  expect(update.notices.map(({ message }) => message.appliesToYou)).toEqual([
    "The notice sent for the earlier decision no longer applies to you.",
  ]);
});

it("sends the all-clear to the original recipients, timed to the day operations resume", () => {
  const allClear = buildAllClear({
    original: decidedPackage({
      employees: [employee({ id: 1 }), employee({ id: 2 })],
      directives: [directive("excused", { kind: "employee", employeeId: 2 })],
    }),
    resumesOn: "2026-10-13",
    now: AFTER_DEFAULT_SEND_BY,
  });
  expect({
    original: allClear.original,
    notices: allClear.notices.map(({ employee: { id }, delivery }) => [
      id,
      delivery.sendBy,
    ]),
  }).toEqual({
    original: DECIDED.decision,
    notices: [[1, "2026-10-13T09:55:00.000Z"]],
  });
});

function timelineOf(
  sendBy: string,
  recordedAt: string,
): ReturnType<typeof dispatchTimeline> {
  return dispatchTimeline({
    dispatches: [{ employeeId: 1, channel: "email", sendBy, recordedAt }],
    arrivalWindowStart: ARRIVAL_WINDOW_START,
  });
}

it("reports whole minutes from the recorded dispatch to the arrival window", () => {
  expect(
    timelineOf("2026-10-12T10:00:00.000Z", "2026-10-12T09:56:00.000Z"),
  ).toEqual([
    {
      employeeId: 1,
      channel: "email",
      plannedAt: "2026-10-12T10:00:00.000Z",
      recordedAt: "2026-10-12T09:56:00.000Z",
      minutesBeforeArrivalWindow: 94,
      recordedAfterSendBy: false,
    },
  ]);
});

it("flags a dispatch recorded after its sendBy", () => {
  const timeline = timelineOf(
    "2026-10-12T09:55:00.000Z",
    "2026-10-12T10:05:00.000Z",
  );
  expect(timeline.map((entry) => entry.recordedAfterSendBy)).toEqual([true]);
});

it("accepts only decided packages for follow-ups", () => {
  const followUp = { resumesOn: "2026-10-13", now: NOW };
  const fromDecided = { ...followUp, original: decidedPackage({}) };
  const fromPreview = {
    ...followUp,
    original: buildNotificationPackage({
      ...packageInput({}),
      source: { kind: "preview", recommendationId: 1 },
    }),
  };
  expectTypeOf(buildAllClear).toBeCallableWith(fromDecided);
  // @ts-expect-error A preview has no decision for the all-clear to link to.
  expectTypeOf(buildAllClear).toBeCallableWith(fromPreview);
});
