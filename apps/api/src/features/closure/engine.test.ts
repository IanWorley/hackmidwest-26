import { Value } from "@sinclair/typebox/value";
import { expect, it } from "vitest";
import { EngineInputSchema, evaluatePosture } from "./engine";
import {
  AFTER_GUST,
  AFTERNOON_HOUR,
  ALL_DAY_END,
  AQI_AT,
  AQI_READING,
  alerts,
  crossed,
  forecast,
  GUST_AT,
  input,
  KMH,
  NOW,
  nwsAlert,
  wind,
} from "./engine-test-fixtures";

it.each([
  {
    scenario: "a Severe Winter Storm Warning lasting the day closes",
    input: input(["winter"], {
      alerts: alerts(nwsAlert("Winter Storm Warning", "Severe", ALL_DAY_END)),
    }),
    status: { posture: "full_closure" },
    crossed: ["winter/stormWarning"],
  },
  {
    scenario: "a Winter Storm Warning below Severe crosses nothing",
    input: input(["winter"], {
      alerts: alerts(nwsAlert("Winter Storm Warning", "Moderate", ALL_DAY_END)),
    }),
    status: { posture: "normal" },
    crossed: [],
  },
  {
    scenario: "a Severe Winter Storm Watch is not a listed event",
    input: input(["winter"], {
      alerts: alerts(nwsAlert("Winter Storm Watch", "Severe", ALL_DAY_END)),
    }),
    status: { posture: "normal" },
    crossed: [],
  },
  {
    scenario: "an overnight Moderate Winter Weather Advisory delays arrival",
    input: input(["winter"], {
      alerts: alerts(nwsAlert("Winter Weather Advisory", "Moderate")),
    }),
    status: { posture: "delayed_arrival", delayHours: 3 },
    crossed: ["winter/advisory"],
  },
  {
    scenario: "a 58 mph morning gust delays arrival",
    input: input(["wind"], {
      now: AFTER_GUST,
      readings: [wind("windGust", KMH.mph58, GUST_AT)],
    }),
    status: { posture: "delayed_arrival", delayHours: 2 },
    crossed: ["wind/gust"],
  },
  {
    scenario: "a 57 mph gust crosses nothing",
    input: input(["wind"], {
      now: AFTER_GUST,
      readings: [wind("windGust", KMH.mph57, GUST_AT)],
    }),
    status: { posture: "normal" },
    crossed: [],
  },
  {
    scenario: "one forecast hour of 40 mph sustained wind dismisses early",
    input: input(["wind"], {
      forecast: forecast([...AFTERNOON_HOUR, "40 mph"]),
    }),
    status: {
      posture: "early_dismissal",
      departAt: "2026-01-14T17:45:00.000Z",
      departAtLocal: "11:45",
    },
    crossed: ["wind/sustained"],
  },
  {
    scenario: "one forecast hour of 39 mph sustained wind crosses nothing",
    input: input(["wind"], {
      forecast: forecast([...AFTERNOON_HOUR, "39 mph"]),
    }),
    status: { posture: "normal" },
    crossed: [],
  },
  {
    scenario: "a single observed 45 mph sustained reading proves no full hour",
    input: input(["wind"], {
      readings: [wind("windSpeed", KMH.mph45, "2026-01-14T08:45:00Z")],
    }),
    status: { posture: "normal" },
    crossed: [],
  },
  {
    scenario: "AQI 150 crosses nothing",
    input: input(["airQuality"], {
      now: AQI_AT,
      readings: [{ ...AQI_READING, value: 150 }],
    }),
    status: { posture: "normal" },
    crossed: [],
  },
  {
    scenario: "AQI 151 past the delay cap moves to telework",
    input: input(["airQuality"], {
      now: AQI_AT,
      readings: [{ ...AQI_READING, value: 151 }],
    }),
    status: { posture: "unscheduled_telework" },
    crossed: ["airQuality/unhealthy"],
  },
  {
    scenario: "AQI 200 stays at telework",
    input: input(["airQuality"], {
      now: AQI_AT,
      readings: [{ ...AQI_READING, value: 200 }],
    }),
    status: { posture: "unscheduled_telework" },
    crossed: ["airQuality/unhealthy"],
  },
  {
    scenario: "AQI 201 closes",
    input: input(["airQuality"], {
      now: AQI_AT,
      readings: [{ ...AQI_READING, value: 201 }],
    }),
    status: { posture: "full_closure" },
    crossed: ["airQuality/veryUnhealthy", "airQuality/unhealthy"],
  },
])("$scenario", ({ input: engineInput, status, crossed: expected }) => {
  const recommendation = evaluatePosture(engineInput);
  expect({
    status: recommendation.status,
    crossed: crossed(recommendation),
  }).toEqual({ status, crossed: expected });
});

const OVERLAP = input(["winter", "wind", "airQuality"], {
  now: AQI_AT,
  alerts: alerts(nwsAlert("Winter Weather Advisory", "Moderate")),
  readings: [{ ...AQI_READING, value: 160 }],
  forecast: forecast([...AFTERNOON_HOUR, "45 mph"]),
});

it("recommends the most disruptive hazard and lists every crossed one", () => {
  const recommendation = evaluatePosture(OVERLAP);
  expect({
    status: recommendation.status,
    findings: recommendation.findings.map((finding) => [
      finding.hazard,
      finding.timing.status.posture,
    ]),
  }).toEqual({
    status: { posture: "unscheduled_telework" },
    findings: [
      ["airQuality", "unscheduled_telework"],
      ["wind", "early_dismissal"],
      ["winter", "delayed_arrival"],
    ],
  });
});

it("picks the longer of two delays even when its hazard is listed later", () => {
  const recommendation = evaluatePosture(
    input(["wind", "airQuality"], {
      now: "2026-01-14T12:10:00Z",
      readings: [
        wind("windGust", KMH.mph58, "2026-01-14T12:00:00Z"),
        { ...AQI_READING, observedAt: NOW, value: 160 },
      ],
    }),
  );
  expect({
    status: recommendation.status,
    crossed: crossed(recommendation),
  }).toEqual({
    status: { posture: "delayed_arrival", delayHours: 2 },
    crossed: ["airQuality/unhealthy", "wind/gust"],
  });
});

it("gives the same plain-JSON output for the same input, including after a JSON replay", () => {
  const first = evaluatePosture(OVERLAP);
  const replayed = Value.Parse(
    EngineInputSchema,
    JSON.parse(JSON.stringify(OVERLAP)),
  );
  expect(first.status).toEqual({ posture: "unscheduled_telework" });
  expect(evaluatePosture(structuredClone(OVERLAP))).toStrictEqual(first);
  expect(evaluatePosture(replayed)).toStrictEqual(first);
  expect(JSON.parse(JSON.stringify(first))).toStrictEqual(first);
});
