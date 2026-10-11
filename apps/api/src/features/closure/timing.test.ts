import { ROAD_CLASSES, type RoadClass } from "@hackmidwest/db";
import { describe, expect, it } from "vitest";
import {
  evaluateTiming,
  type OpmStatus,
  type TimingCase,
  type TimingInput,
} from "./timing";
import { alert, FACILITY, period, timing } from "./timing-test-fixtures";

interface RowCase {
  readonly scenario: string;
  readonly input: TimingInput;
  readonly timingCase: TimingCase;
  readonly status: OpmStatus;
}

const ROW_CASES = {
  clearsBeforeArrival: {
    scenario: "winter storm ends 01:00 local, clears 06:00 before arrival",
    input: timing({
      evidence: alert("2026-01-13T22:00:00Z", "2026-01-14T07:00:00Z"),
    }),
    timingCase: { kind: "clearsBeforeArrival" },
    status: { posture: "normal" },
  },
  alreadyCleared: {
    scenario: "re-evaluation at 10:30 local after the 10:00 clearance",
    input: timing({
      now: "2026-01-14T16:30:00Z",
      evidence: alert("2026-01-14T06:00:00Z", "2026-01-14T11:00:00Z"),
    }),
    timingCase: { kind: "alreadyCleared" },
    status: { posture: "normal" },
  },
  delayWithinCap: {
    scenario: "snow ends 05:00 local with arrival at 07:00 (#49)",
    input: timing({
      evidence: alert("2026-01-14T06:00:00Z", "2026-01-14T11:00:00Z"),
    }),
    timingCase: { kind: "delayWithinCap", delayHours: 3 },
    status: { posture: "delayed_arrival", delayHours: 3 },
  },
  outlastsDelayCap: {
    scenario: "winter advisory still active at 07:00 escalates (#49)",
    input: timing({
      crossedPosture: "delayed_arrival",
      evidence: alert("2026-01-14T10:00:00Z", "2026-01-14T14:00:00Z"),
    }),
    timingCase: { kind: "outlastsDelayCap", delayHours: 6 },
    status: { posture: "unscheduled_telework" },
  },
  startsDuringHours: {
    scenario: "forecast-only wind from 13:00 local",
    input: timing({
      hazard: "wind",
      crossedPosture: "early_dismissal",
      evidence: {
        source: "forecast",
        exceedingPeriods: [
          period("2026-01-14T22:00:00Z", "2026-01-14T23:00:00Z"),
          period("2026-01-14T19:00:00Z", "2026-01-14T20:00:00Z"),
        ],
      },
    }),
    timingCase: {
      kind: "startsDuringHours",
      releaseAt: "2026-01-14T17:45:00.000Z",
    },
    status: {
      posture: "early_dismissal",
      departAt: "2026-01-14T17:45:00.000Z",
      departAtLocal: "11:45",
    },
  },
  spansOperatingDay: {
    scenario: "winter storm from midnight local to 21:00 local",
    input: timing({
      evidence: alert("2026-01-14T06:00:00Z", "2026-01-15T03:00:00Z"),
    }),
    timingCase: { kind: "spansOperatingDay" },
    status: { posture: "full_closure" },
  },
  startsAfterHours: {
    scenario: "wind from 20:00 local, after the 16:30 close",
    input: timing({
      hazard: "wind",
      evidence: alert("2026-01-15T02:00:00Z", "2026-01-15T06:00:00Z"),
    }),
    timingCase: { kind: "startsAfterHours", nextDay: "2026-01-15" },
    status: { posture: "normal" },
  },
} satisfies Record<TimingCase["kind"], RowCase>;

it.each(Object.entries(ROW_CASES).map(([kind, row]) => ({ kind, ...row })))(
  "timing case $kind: $scenario",
  ({ input, timingCase, status }) => {
    const result = evaluateTiming(input);
    expect([result.timingCase, result.status]).toEqual([timingCase, status]);
  },
);

// #49 asked for both winter edge cases per road class once #56 landed. Buffers run 180, 300, 540,
// 720, and 2160 minutes, so only super-commuter roads keep the active-at-07:00 advisory a delay.
const SNOW_ENDS_0500_BY_ROAD_CLASS = {
  superCommuter: { posture: "delayed_arrival", delayHours: 1 },
  urbanCommuter: { posture: "delayed_arrival", delayHours: 3 },
  ruralCommuter: { posture: "full_closure" },
  primary: { posture: "full_closure" },
  secondary: { posture: "full_closure" },
} satisfies Record<RoadClass, OpmStatus>;

const ADVISORY_ACTIVE_0700_BY_ROAD_CLASS = {
  superCommuter: { posture: "delayed_arrival", delayHours: 4 },
  urbanCommuter: { posture: "unscheduled_telework" },
  ruralCommuter: { posture: "unscheduled_telework" },
  primary: { posture: "unscheduled_telework" },
  secondary: { posture: "unscheduled_telework" },
} satisfies Record<RoadClass, OpmStatus>;

it.each(
  ROAD_CLASSES.map((roadClass) => ({
    roadClass,
    status: SNOW_ENDS_0500_BY_ROAD_CLASS[roadClass],
  })),
)(
  "snow ending 05:00 local on $roadClass roads gives $status.posture",
  ({ roadClass, status }) => {
    const result = evaluateTiming(
      timing({
        facility: { ...FACILITY, roadClass },
        evidence: alert("2026-01-14T06:00:00Z", "2026-01-14T11:00:00Z"),
      }),
    );
    expect(result.status).toEqual(status);
  },
);

it.each(
  ROAD_CLASSES.map((roadClass) => ({
    roadClass,
    status: ADVISORY_ACTIVE_0700_BY_ROAD_CLASS[roadClass],
  })),
)(
  "an advisory active at 07:00 local on $roadClass roads gives $status.posture",
  ({ roadClass, status }) => {
    const result = evaluateTiming(
      timing({
        facility: { ...FACILITY, roadClass },
        crossedPosture: "delayed_arrival",
        evidence: alert("2026-01-14T10:00:00Z", "2026-01-14T14:00:00Z"),
      }),
    );
    expect(result.status).toEqual(status);
  },
);

it("closes instead of teleworking when the crossed cutoff is a closure", () => {
  const result = evaluateTiming(
    timing({
      crossedPosture: "full_closure",
      evidence: alert("2026-01-14T10:00:00Z", "2026-01-14T14:00:00Z"),
    }),
  );
  expect(result.status).toEqual({ posture: "full_closure" });
});

it("delays rather than dismisses a hazard that starts inside the arrival window", () => {
  const result = evaluateTiming(
    timing({
      hazard: "wind",
      crossedPosture: "early_dismissal",
      evidence: alert("2026-01-14T13:30:00Z", "2026-01-14T13:45:00Z"),
    }),
  );
  expect(result.status).toEqual({ posture: "delayed_arrival", delayHours: 2 });
});

it("treats a hazard starting after close but inside the departure window as next-day", () => {
  const result = evaluateTiming(
    timing({
      hazard: "wind",
      crossedPosture: "early_dismissal",
      evidence: alert("2026-01-14T23:00:00Z", "2026-01-15T03:00:00Z"),
    }),
  );
  expect(result.timingCase).toEqual({
    kind: "startsAfterHours",
    nextDay: "2026-01-15",
  });
});

it("teleworks when the release time would fall before opening", () => {
  const result = evaluateTiming(
    timing({
      facility: { ...FACILITY, typicalCommuteMinutes: 120 },
      hazard: "wind",
      crossedPosture: "early_dismissal",
      evidence: alert("2026-01-14T15:00:00Z", "2026-01-14T20:00:00Z"),
    }),
  );
  expect(result.timingCase).toEqual({ kind: "spansOperatingDay" });
  expect(result.status).toEqual({ posture: "unscheduled_telework" });
});

it("marks an end that fell back to the alert's expires time", () => {
  const result = evaluateTiming(
    timing({
      evidence: alert(
        "2026-01-14T06:00:00Z",
        "2026-01-14T11:00:00Z",
        "expires",
      ),
    }),
  );
  expect(result.hazardWindow.endBasis).toBe("expires");
  expect(result.status).toEqual({ posture: "delayed_arrival", delayHours: 3 });
});

it("extends an expires end with later exceeding forecast hours", () => {
  const result = evaluateTiming(
    timing({
      evidence: alert(
        "2026-01-14T06:00:00Z",
        "2026-01-14T11:00:00Z",
        "expires",
        [
          period("2026-01-14T10:00:00Z", "2026-01-14T11:00:00Z"),
          period("2026-01-14T11:00:00Z", "2026-01-14T12:00:00Z"),
        ],
      ),
    }),
  );
  expect(result.hazardWindow).toEqual({
    start: "2026-01-14T06:00:00.000Z",
    end: "2026-01-14T12:00:00.000Z",
    endBasis: "forecast",
    clearsAt: "2026-01-14T17:00:00.000Z",
  });
  expect(result.status).toEqual({ posture: "delayed_arrival", delayHours: 4 });
});

it.each([
  { now: "2026-01-14T22:29:00Z", facilityDate: "2026-01-14" },
  { now: "2026-01-14T22:30:00Z", facilityDate: "2026-01-15" },
  { now: "2026-01-14T05:00:00Z", facilityDate: "2026-01-14" },
])("evaluates $facilityDate for a run at $now", ({ now, facilityDate }) => {
  expect(evaluateTiming(timing({ now })).facilityDate).toBe(facilityDate);
});

// `now` sits before each transition, so an offset sampled at `now` or a fixed offset is wrong.
describe("DST transition days", () => {
  it("places arrival at 12:00Z on the spring-forward day", () => {
    const result = evaluateTiming(
      timing({
        now: "2026-03-08T06:00:00Z",
        evidence: alert("2026-03-08T04:00:00Z", "2026-03-08T10:00:00Z"),
      }),
    );
    expect(result.facilityDate).toBe("2026-03-08");
    expect(result.status).toEqual({
      posture: "delayed_arrival",
      delayHours: 3,
    });
  });

  it("places arrival at 13:00Z on the fall-back day", () => {
    const result = evaluateTiming(
      timing({
        now: "2026-11-01T06:00:00Z",
        evidence: alert("2026-11-01T04:00:00Z", "2026-11-01T11:00:00Z"),
      }),
    );
    expect(result.facilityDate).toBe("2026-11-01");
    expect(result.status).toEqual({
      posture: "delayed_arrival",
      delayHours: 3,
    });
  });
});

it("returns the scheduled departure time even after it has passed", () => {
  const result = evaluateTiming(
    timing({
      now: "2026-01-14T20:05:00Z",
      hazard: "wind",
      crossedPosture: "early_dismissal",
      evidence: alert("2026-01-14T20:30:00Z", "2026-01-14T23:00:00Z"),
    }),
  );
  expect(result.status).toEqual({
    posture: "early_dismissal",
    departAt: "2026-01-14T19:15:00.000Z",
    departAtLocal: "13:15",
  });
});
