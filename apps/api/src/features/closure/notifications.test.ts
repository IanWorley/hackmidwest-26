import { expect, it } from "vitest";
import {
  AFTER_DEFAULT_SEND_BY,
  ARRIVAL_WINDOW_START,
  DEFAULT_SEND_BY,
  decidedPackage,
  directive,
  dismissedAt,
  employee,
  FACILITY_NAME,
  NORMAL,
  type PackageFields,
  PHONE,
  RELEASE_AFTER_START,
  teleworkingSince,
} from "./notification-test-fixtures";

const OWN_SCHEDULE = {
  shiftStart: "07:00",
  shiftEnd: "15:30",
  commuteMinutes: 50,
};
const RELEASED_BY_DIRECTIVE: PackageFields = {
  posture: NORMAL,
  directives: [dismissedAt(RELEASE_AFTER_START)],
};

it.each<[string, PackageFields, string]>([
  [
    "the employee's own shift start and commute",
    { employees: [employee({ id: 1, ...OWN_SCHEDULE })] },
    "2026-10-12T10:10:00.000Z",
  ],
  ["the facility arrival window and typical commute", {}, DEFAULT_SEND_BY],
  [
    "an early release once they have left home, with no commute",
    { ...RELEASED_BY_DIRECTIVE, now: AFTER_DEFAULT_SEND_BY },
    "2026-10-12T18:00:00.000Z",
  ],
  [
    "their commute when an early release is decided before they leave home",
    RELEASED_BY_DIRECTIVE,
    DEFAULT_SEND_BY,
  ],
  [
    "their commute when the release is at their start",
    { posture: NORMAL, directives: [dismissedAt(ARRIVAL_WINDOW_START)] },
    DEFAULT_SEND_BY,
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

it("keeps a notice on time at its exact sendBy", () => {
  const pkg = decidedPackage({
    employees: [employee({ id: 1, mobilePhone: PHONE })],
    now: DEFAULT_SEND_BY,
  });
  expect(
    pkg.recipients.map(({ delivery }) => [delivery.late, delivery.channel]),
  ).toEqual([[false, "email"]]);
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
  const pkg = decidedPackage(RELEASED_BY_DIRECTIVE);
  expect(pkg.recipients.map(({ message }) => message.appliesToYou)).toEqual([
    "You are released early at 14:00. A manager issued a directive for you: Ice on the access road.",
  ]);
});

it("does not claim a release exactly at their start comes before it", () => {
  const pkg = decidedPackage({
    posture: NORMAL,
    directives: [dismissedAt(ARRIVAL_WINDOW_START)],
  });
  expect(pkg.recipients.map(({ message }) => message.appliesToYou)).toEqual([
    "Your release time, 06:30, is no later than your 06:30 start. A manager issued a directive for you: Ice on the access road.",
  ]);
});

it("tells someone whose shift ends before the release to work normal hours", () => {
  const pkg = decidedPackage({
    ...RELEASED_BY_DIRECTIVE,
    employees: [employee({ id: 1, shiftStart: "05:30", shiftEnd: "13:30" })],
  });
  expect(pkg.recipients.map(({ message }) => message.whatToDo)).toEqual([
    "Work your normal hours.",
  ]);
});

it("tells a dismissed teleworker to stop work rather than leave the facility", () => {
  const pkg = decidedPackage({
    ...RELEASED_BY_DIRECTIVE,
    statusEvents: [teleworkingSince(1, "2026-10-12T03:00:00.000Z")],
  });
  expect(pkg.recipients.map(({ message }) => message.whatToDo)).toEqual([
    "Stop work at 14:00.",
  ]);
});
