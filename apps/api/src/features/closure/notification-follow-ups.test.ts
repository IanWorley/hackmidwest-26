import { expect, expectTypeOf, it } from "vitest";
import {
  AFTER_DEFAULT_SEND_BY,
  ARRIVAL_WINDOW_START,
  DECIDED,
  decidedPackage,
  directive,
  employee,
  FACILITY_NAME,
  NORMAL,
  NOW,
  packageInput,
  SUPERSEDING,
} from "./notification-test-fixtures";
import {
  buildAllClear,
  buildNotificationPackage,
  buildPostureChangeUpdate,
  dispatchTimeline,
} from "./notifications";

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

it("rejects an all-clear for a date that does not exist", () => {
  expect(() =>
    buildAllClear({
      original: decidedPackage({}),
      resumesOn: "2026-02-30",
      now: NOW,
    }),
  ).toThrow("Not a YYYY-MM-DD calendar date: 2026-02-30");
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
