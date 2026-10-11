import type { Hazard } from "@hackmidwest/db";
import { describe, expect, it } from "vitest";
import type { CutoffName } from "./cutoff-names";
import { type EngineInput, evaluatePosture } from "./engine";
import {
  ADVISORY_ENDS_0300,
  AQI,
  alert,
  aqi,
  CALM_GUST_KMH,
  CLEAN_AQI,
  DURING_ARRIVAL,
  EARLY_DISMISSAL_1145,
  ENDS_0300_LOCAL,
  engineInput,
  facility,
  GUST_AT_CUTOFF_KMH,
  GUST_BELOW_CUTOFF_KMH,
  GUST_OBSERVED_DURING_ARRIVAL,
  gust,
  STORM_ALL_DAY,
  WIND_40_AT_1300,
  windAt,
  withAqi,
  withGustDuringArrival,
} from "./engine-test-fixtures";
import type { OpmStatus } from "./timing";

interface BoundaryRow {
  readonly scenario: string;
  readonly input: EngineInput;
  readonly cutoff: readonly [Hazard, CutoffName];
  readonly margin: number;
  readonly status: OpmStatus;
}

const BOUNDARY_ROWS: readonly BoundaryRow[] = [
  {
    scenario: "a Moderate Winter Storm Warning stays below the Severe cutoff",
    input: engineInput({
      alerts: [alert("Winter Storm Warning", "Moderate", STORM_ALL_DAY)],
    }),
    cutoff: ["winter", "stormWarning"],
    margin: -1,
    status: { posture: "normal" },
  },
  {
    scenario: "a Severe Winter Storm Warning all day closes",
    input: engineInput({
      alerts: [alert("Winter Storm Warning", "Severe", STORM_ALL_DAY)],
    }),
    cutoff: ["winter", "stormWarning"],
    margin: 0,
    status: { posture: "full_closure" },
  },
  {
    scenario: "a Minor advisory stays below the Moderate cutoff",
    input: engineInput({
      alerts: [alert("Winter Weather Advisory", "Minor", ENDS_0300_LOCAL)],
    }),
    cutoff: ["winter", "advisory"],
    margin: -1,
    status: { posture: "normal" },
  },
  {
    scenario:
      "a Moderate advisory ending 03:00 delays arrival past the 5-hour road buffer",
    input: engineInput({ alerts: [ADVISORY_ENDS_0300] }),
    cutoff: ["winter", "advisory"],
    margin: 0,
    status: { posture: "delayed_arrival", delayHours: 1 },
  },
  {
    scenario: "forecast wind of 39 mph stays below the 40 mph sustained cutoff",
    input: engineInput({
      forecast: windAt(
        "2026-01-14T19:00:00Z",
        "2026-01-14T20:00:00Z",
        "39 mph",
      ),
    }),
    cutoff: ["wind", "sustained"],
    margin: -1,
    status: { posture: "normal" },
  },
  {
    scenario: "forecast wind of 40 mph from 13:00 dismisses early",
    input: engineInput({ forecast: WIND_40_AT_1300 }),
    cutoff: ["wind", "sustained"],
    margin: 0,
    status: EARLY_DISMISSAL_1145,
  },
  {
    scenario: "a 57.9 mph gust stays below the 58 mph cutoff",
    input: withGustDuringArrival(GUST_BELOW_CUTOFF_KMH),
    cutoff: ["wind", "gust"],
    margin: -0.1,
    status: { posture: "normal" },
  },
  {
    scenario: "a 58 mph gust during arrival holds arrivals 2 hours",
    input: withGustDuringArrival(GUST_AT_CUTOFF_KMH),
    cutoff: ["wind", "gust"],
    margin: 0,
    status: { posture: "delayed_arrival", delayHours: 2 },
  },
  {
    scenario: "AQI 150 stays below Unhealthy",
    input: withAqi(AQI.belowUnhealthy),
    cutoff: ["airQuality", "unhealthy"],
    margin: -1,
    status: { posture: "normal" },
  },
  {
    scenario: "AQI 151 holding through the day is telework",
    input: withAqi(AQI.unhealthy),
    cutoff: ["airQuality", "unhealthy"],
    margin: 0,
    status: { posture: "unscheduled_telework" },
  },
  {
    scenario: "AQI 200 stays below Very Unhealthy",
    input: withAqi(AQI.belowVeryUnhealthy),
    cutoff: ["airQuality", "veryUnhealthy"],
    margin: -1,
    status: { posture: "unscheduled_telework" },
  },
  {
    scenario: "AQI 201 holding through the day closes",
    input: withAqi(AQI.veryUnhealthy),
    cutoff: ["airQuality", "veryUnhealthy"],
    margin: 0,
    status: { posture: "full_closure" },
  },
];

describe("posture boundaries", () => {
  it.each(BOUNDARY_ROWS)("$scenario", ({ input, cutoff, margin, status }) => {
    const [hazard, name] = cutoff;
    const result = evaluatePosture(input);
    const check = result.hazards
      .find((assessment) => assessment.hazard === hazard)
      ?.checks.find((candidate) => candidate.cutoff === name);
    expect(check?.outcome).toMatchObject({ margin });
    expect(result.status).toEqual(status);
  });
});

const OVERLAP = engineInput({
  alerts: [ADVISORY_ENDS_0300],
  forecast: WIND_40_AT_1300,
  readings: [gust(CALM_GUST_KMH), aqi(AQI.smoky)],
});

it("recommends the most disruptive hazard and lists every hazard's posture", () => {
  const result = evaluatePosture(OVERLAP);
  expect({
    status: result.status,
    driver: [result.driver?.hazard, result.driver?.cutoff],
    hazards: result.hazards.map(({ hazard, posture }) => [hazard, posture]),
  }).toEqual({
    status: { posture: "unscheduled_telework" },
    driver: ["airQuality", "unhealthy"],
    hazards: [
      ["winter", "delayed_arrival"],
      ["wind", "early_dismissal"],
      ["airQuality", "unscheduled_telework"],
    ],
  });
});

it("takes the longer delay when two hazards both delay arrival", () => {
  const result = evaluatePosture(
    engineInput({
      now: DURING_ARRIVAL,
      alerts: [ADVISORY_ENDS_0300],
      readings: [
        gust(GUST_AT_CUTOFF_KMH, GUST_OBSERVED_DURING_ARRIVAL),
        aqi(CLEAN_AQI),
      ],
    }),
  );
  expect([result.status, result.driver?.hazard]).toEqual([
    { posture: "delayed_arrival", delayHours: 2 },
    "wind",
  ]);
});

it("returns a deep-equal recommendation after a JSON round trip of its input", () => {
  const replayed = evaluatePosture(JSON.parse(JSON.stringify(OVERLAP)));
  expect(JSON.parse(JSON.stringify(replayed))).toStrictEqual(
    evaluatePosture(OVERLAP),
  );
  expect(replayed.status).toEqual({ posture: "unscheduled_telework" });
});

it("states how a 2-hour shift in the hazard window changes the recommendation", () => {
  const result = evaluatePosture(
    engineInput({
      forecast: windAt(
        "2026-01-14T21:00:00Z",
        "2026-01-14T22:00:00Z",
        "40 mph",
      ),
    }),
  );
  expect(result.sensitivity.map(({ statement }) => statement)).toEqual([
    "If the hazard window moves 2 hours earlier, this becomes early dismissal at 11:45 instead of early dismissal at 13:45.",
    "If the hazard window moves 2 hours later, this becomes normal operations instead of early dismissal at 13:45.",
  ]);
});

it("writes a one-paragraph rationale citing the crossed cutoff, confidence, and deadline", () => {
  const result = evaluatePosture(engineInput({ forecast: WIND_40_AT_1300 }));
  expect([result.decideBy, result.rationale]).toEqual([
    "2026-01-14T11:00:00.000Z",
    "Recommend early dismissal at 11:45 for 2026-01-14. Wind reached 40 mph against the 40 mph sustained cutoff (+0), per National Weather Service, NWSI 10-515 WFO Non-Precipitation Weather Products Specification (May 16, 2025). Timed against the facility day, it calls for early dismissal at 11:45. This drives the recommendation. Confidence is medium: the hazard's end comes from forecast hours or a single reading. Decide by 05:00 local time.",
  ]);
});

it("lists each input a check read, with its source and timestamp", () => {
  expect(evaluatePosture(engineInput()).inputs).toEqual([
    {
      kind: "forecast",
      source: "nws",
      ref: "forecast-hourly",
      asOf: "2026-01-14T08:00:00Z",
    },
    {
      kind: "observations",
      source: "nws",
      ref: "obs-2026-01-14T08:30:00Z",
      asOf: "2026-01-14T08:30:00Z",
    },
    {
      kind: "airQuality",
      source: "open-meteo",
      ref: "aqi-0800",
      asOf: "2026-01-14T08:00:00Z",
    },
  ]);
});

it("assesses only the hazards in the facility's profile", () => {
  const result = evaluatePosture(
    engineInput({
      facility: facility(["winter"]),
      readings: [gust(CALM_GUST_KMH), aqi(AQI.hazardous)],
    }),
  );
  expect([result.status, result.hazards.map(({ hazard }) => hazard)]).toEqual([
    { posture: "normal" },
    ["winter"],
  ]);
});

it("explains a crossing that clears before arrival without calling it the driver", () => {
  const overnightStorm = alert("Winter Storm Warning", "Severe", [
    "2026-01-13T22:00:00Z",
    "2026-01-14T03:00:00Z",
  ]);
  expect(
    evaluatePosture(engineInput({ alerts: [overnightStorm] })).rationale,
  ).toBe(
    "Recommend normal operations for 2026-01-14. Winter weather reached Severe severity against the Severe severity stormWarning cutoff (+0), per National Weather Service, NWSI 10-513 WFO Winter Weather Products Specification (November 6, 2024), with OASIS CAP v1.2 severity as served by api.weather.gov. Timed against the facility day, it calls for normal operations. Confidence is high. Decide by 05:00 local time.",
  );
});
