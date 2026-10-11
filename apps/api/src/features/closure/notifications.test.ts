import { expect, it } from "vitest";
import {
  AFTER_DEFAULT_SEND_BY,
  ARRIVAL_WINDOW_START,
  AT_WORK,
  DEFAULT_SEND_BY,
  decidedPackage,
  directive,
  dismissedAt,
  employee,
  FACILITY_NAME,
  NORMAL,
  NOW,
  type PackageFields,
  PHONE,
  RELEASE_AFTER_START,
  statusSince,
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
    "an early release once they are at work, with no commute",
    { ...RELEASED_BY_DIRECTIVE, now: AT_WORK },
    "2026-10-12T18:00:00.000Z",
  ],
  [
    "their overdue commute deadline until they start work",
    { ...RELEASED_BY_DIRECTIVE, now: AFTER_DEFAULT_SEND_BY },
    DEFAULT_SEND_BY,
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
    statusEvents: [statusSince(1, "teleworking", "2026-10-12T03:00:00.000Z")],
  });
  expect(pkg.recipients.map(({ message }) => message.whatToDo)).toEqual([
    "Stop work at 14:00.",
  ]);
});

it("tells someone on leave to stay off work rather than leave the facility", () => {
  const pkg = decidedPackage({
    ...RELEASED_BY_DIRECTIVE,
    statusEvents: [statusSince(1, "not_working", "2026-10-12T03:00:00.000Z")],
  });
  expect(pkg.recipients.map(({ message }) => message.whatToDo)).toEqual([
    "Stay off work as planned.",
  ]);
});

it("tells someone to leave now once their release time has passed", () => {
  const pkg = decidedPackage({
    ...RELEASED_BY_DIRECTIVE,
    now: "2026-10-12T19:30:00.000Z",
  });
  expect(pkg.recipients.map(({ message }) => message.whatToDo)).toEqual([
    `Leave ${FACILITY_NAME} now.`,
  ]);
});

it("does not claim a release exactly at their shift end comes after it", () => {
  const pkg = decidedPackage({
    ...RELEASED_BY_DIRECTIVE,
    employees: [employee({ id: 1, shiftStart: "06:00", shiftEnd: "14:00" })],
  });
  expect(pkg.recipients.map(({ message }) => message.appliesToYou)).toEqual([
    "Your shift ends at 14:00, no later than the 14:00 release. A manager issued a directive for you: Ice on the access road.",
  ]);
});

it.each<[string, PackageFields, string]>([
  [
    "times alone for a hazard within one facility day",
    {},
    "from 04:00 to 11:00",
  ],
  [
    "dates for a hazard that spans facility days",
    {
      hazard: {
        kind: "winter",
        start: "2026-10-13T04:00:00.000Z",
        end: "2026-10-14T08:00:00.000Z",
      },
    },
    "from 2026-10-12 23:00 to 2026-10-14 03:00",
  ],
])("describes the hazard window with %s", (_case, fields, window) => {
  const pkg = decidedPackage(fields);
  expect(pkg.recipients.map(({ message }) => message.whatsHappening)).toEqual([
    `Winter weather expected ${window}. ${FACILITY_NAME} is closed on 2026-10-12.`,
  ]);
});

it("tells an onsite worker dismissed after their start to leave now", () => {
  const pkg = decidedPackage({
    employees: [employee({ id: 1, teleworkEligible: false })],
    now: AT_WORK,
  });
  expect(pkg.recipients.map(({ message }) => message.whatToDo)).toEqual([
    `Leave ${FACILITY_NAME} now.`,
  ]);
});

it("describes a delayed arrival without moving the facility's opening", () => {
  const pkg = decidedPackage({
    posture: { posture: "delayed_arrival", delayMinutes: 120 },
  });
  expect(pkg.recipients.map(({ message }) => message.subject)).toEqual([
    `${FACILITY_NAME} has a 120-minute delayed arrival on 2026-10-12`,
  ]);
});

it("tells someone whose shift ends before the delayed arrival not to report", () => {
  const pkg = decidedPackage({
    posture: { posture: "delayed_arrival", delayMinutes: 240 },
    employees: [employee({ id: 1, shiftStart: "07:00", shiftEnd: "08:00" })],
  });
  expect(pkg.recipients.map(({ message }) => message.whatToDo)).toEqual([
    `Do not report to ${FACILITY_NAME} today.`,
  ]);
});

it("tells someone whose delayed arrival has passed to report now", () => {
  const pkg = decidedPackage({
    posture: { posture: "delayed_arrival", delayMinutes: 120 },
    now: "2026-10-12T15:00:00.000Z",
  });
  expect(pkg.recipients.map(({ message }) => message.whatToDo)).toEqual([
    `Report to ${FACILITY_NAME} now.`,
  ]);
});

it.each<[string, string, string]>([
  ["by their start before it", NOW, `Report to ${FACILITY_NAME} by 06:30.`],
  ["now after their start", AT_WORK, `Report to ${FACILITY_NAME} now.`],
])(
  "tells a teleworker named in a report directive to report %s",
  (_case, now, whatToDo) => {
    const pkg = decidedPackage({
      posture: NORMAL,
      now,
      statusEvents: [statusSince(1, "teleworking", "2026-10-12T03:00:00.000Z")],
      directives: [directive("report")],
    });
    expect(pkg.recipients.map(({ message }) => message.whatToDo)).toEqual([
      whatToDo,
    ]);
  },
);

const SHIFT_UNTIL_15 = { shiftStart: "06:30", shiftEnd: "15:00" };
const AFTER_SHIFT = "2026-10-12T21:00:00.000Z";

it.each<[string, PackageFields]>([
  [
    "a delayed arrival",
    { posture: { posture: "delayed_arrival", delayMinutes: 120 } },
  ],
  ["a release during the shift", RELEASED_BY_DIRECTIVE],
])(
  "says no action is needed once their shift has ended, for %s",
  (_case, fields) => {
    const pkg = decidedPackage({
      ...fields,
      employees: [employee({ id: 1, ...SHIFT_UNTIL_15 })],
      now: AFTER_SHIFT,
    });
    expect(pkg.recipients.map(({ message }) => message.whatToDo)).toEqual([
      "Your shift today has ended, so no action is needed.",
    ]);
  },
);

it("tells an onsite worker moved to telework mid-shift to leave and work from home", () => {
  const pkg = decidedPackage({ now: AT_WORK });
  expect(pkg.recipients.map(({ message }) => message.whatToDo)).toEqual([
    `Leave ${FACILITY_NAME} and work from home for the rest of the day.`,
  ]);
});
