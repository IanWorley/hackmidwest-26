import { expect, it } from "vitest";
import { evaluatePosture } from "./engine";
import {
  AFTERNOON_HOUR,
  ALL_DAY_END,
  AQI_AT,
  AQI_READING,
  alerts,
  forecast,
  input,
  nwsAlert,
} from "./engine-test-fixtures";
import { type PostureTimings, postureOfDecision } from "./facility-posture";

const ADVISORY_DELAY = evaluatePosture(
  input(["winter"], {
    alerts: alerts(nwsAlert("Winter Weather Advisory", "Moderate")),
  }),
);
const SUSTAINED_WIND_DISMISSAL = evaluatePosture(
  input(["wind"], { forecast: forecast([...AFTERNOON_HOUR, "40 mph"]) }),
);
const ALL_DAY_CLOSURE = evaluatePosture(
  input(["winter"], {
    alerts: alerts(nwsAlert("Winter Storm Warning", "Severe", ALL_DAY_END)),
  }),
);
const CAPPED_AQI_TELEWORK = evaluatePosture(
  input(["airQuality"], {
    now: AQI_AT,
    readings: [{ ...AQI_READING, value: 151 }],
  }),
);

it.each([
  {
    scenario: "an accepted delayed arrival announces its delay in minutes",
    decision: { action: "accept", chosenPosture: "delayed_arrival" },
    recommendation: ADVISORY_DELAY,
    expected: {
      kind: "decided",
      posture: { posture: "delayed_arrival", delayMinutes: 180 },
    },
  },
  {
    scenario: "an accepted early dismissal announces its departure time",
    decision: { action: "accept", chosenPosture: "early_dismissal" },
    recommendation: SUSTAINED_WIND_DISMISSAL,
    expected: {
      kind: "decided",
      posture: {
        posture: "early_dismissal",
        releaseAt: "2026-01-14T17:45:00.000Z",
      },
    },
  },
  {
    scenario: "an override to normal needs no timing",
    decision: { action: "override", chosenPosture: "normal" },
    recommendation: ALL_DAY_CLOSURE,
    expected: { kind: "decided", posture: { posture: "normal" } },
  },
  {
    scenario: "an override back to a capped delay takes the finding's delay",
    decision: { action: "override", chosenPosture: "delayed_arrival" },
    recommendation: CAPPED_AQI_TELEWORK,
    expected: {
      kind: "decided",
      posture: { posture: "delayed_arrival", delayMinutes: 180 },
    },
  },
  {
    scenario: "an override to a dismissal nothing timed is untimed",
    decision: { action: "override", chosenPosture: "early_dismissal" },
    recommendation: ALL_DAY_CLOSURE,
    expected: { kind: "untimed", posture: "early_dismissal" },
  },
  {
    scenario: "a deferral sets no posture",
    decision: { action: "defer", chosenPosture: null },
    recommendation: ADVISORY_DELAY,
    expected: { kind: "undecided", action: "defer" },
  },
  {
    scenario: "a missed deadline sets no posture",
    decision: { action: "no_decision", chosenPosture: null },
    recommendation: ADVISORY_DELAY,
    expected: { kind: "undecided", action: "no_decision" },
  },
] as const)("$scenario", ({ decision, recommendation, expected }) => {
  expect(postureOfDecision(decision, recommendation)).toEqual(expected);
});

it("announces a finding's clamped release, not the passed one its timing case kept", () => {
  const clampedAt = "2026-01-14T18:00:00.000Z";
  const recommendation: PostureTimings = {
    status: { posture: "full_closure" },
    findings: [
      {
        timing: {
          status: { posture: "full_closure" },
          timingCase: { kind: "spansOperatingDay" },
        },
      },
      {
        timing: {
          status: {
            posture: "early_dismissal",
            departAt: clampedAt,
            departAtLocal: "12:00",
          },
          timingCase: {
            kind: "startsDuringHours",
            releaseAt: "2026-01-14T16:00:00.000Z",
          },
        },
      },
    ],
  };

  expect(
    postureOfDecision(
      { action: "override", chosenPosture: "early_dismissal" },
      recommendation,
    ),
  ).toEqual({
    kind: "decided",
    posture: { posture: "early_dismissal", releaseAt: clampedAt },
  });
});

it("takes the longest delay any finding carries for an override to a delayed arrival", () => {
  const recommendation: PostureTimings = {
    status: { posture: "full_closure" },
    findings: [
      {
        timing: {
          status: { posture: "full_closure" },
          timingCase: { kind: "outlastsDelayCap", delayHours: 3 },
        },
      },
      {
        timing: {
          status: { posture: "unscheduled_telework" },
          timingCase: { kind: "outlastsDelayCap", delayHours: 6 },
        },
      },
    ],
  };

  expect(
    postureOfDecision(
      { action: "override", chosenPosture: "delayed_arrival" },
      recommendation,
    ),
  ).toEqual({
    kind: "decided",
    posture: { posture: "delayed_arrival", delayMinutes: 360 },
  });
});
