import { describe, expect, it } from "vitest";
import type { HazardEvidence } from "./hazard-window";
import {
  evaluateTiming,
  type FacilitySchedule,
  type OpmStatus,
  type TimingCase,
  type TimingInput,
} from "./timing";

// 2026-01-14 is CST (UTC-6): arrival opens 13:00Z and the facility closes at 22:30Z.
const FACILITY: FacilitySchedule = {
  timezone: "America/Chicago",
  opensAt: "07:30",
  closesAt: "16:30",
  arrivalWindowStart: "07:00",
  arrivalWindowEnd: "09:00",
  typicalCommuteMinutes: 35,
};
const NOW = "2026-01-14T09:00:00Z";

type Period = HazardEvidence["exceedingPeriods"][number];

function period(startTime: string, endTime: string): Period {
  return { startTime, endTime };
}

function alert(
  start: string,
  end: string,
  endBasis: "ends" | "expires" = "ends",
  exceedingPeriods: readonly Period[] = [],
): HazardEvidence {
  return {
    source: "alert",
    window: { start, end, endBasis },
    exceedingPeriods,
  };
}

function timing(overrides: Partial<TimingInput>): TimingInput {
  return {
    now: NOW,
    facility: FACILITY,
    hazard: "winter",
    crossedPosture: "full_closure",
    evidence: alert("2026-01-14T06:00:00Z", "2026-01-14T11:00:00Z"),
    ...overrides,
  };
}

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
  "§5.1 row $kind: $scenario",
  ({ input, timingCase, status }) => {
    const result = evaluateTiming(input);
    expect([result.timingCase, result.status]).toEqual([timingCase, status]);
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

it("releases staff now when the computed departure time has already passed", () => {
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
    departAt: "2026-01-14T20:15:00.000Z",
    departAtLocal: "14:15",
  });
});

it("returns normal once the hazard has cleared, even after arrival opened", () => {
  const result = evaluateTiming(
    timing({
      now: "2026-01-14T16:30:00Z",
      evidence: alert("2026-01-14T06:00:00Z", "2026-01-14T11:00:00Z"),
    }),
  );
  expect(result.status).toEqual({ posture: "normal" });
});
