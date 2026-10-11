import { expect, it } from "vitest";
import { evaluatePosture } from "./engine";
import {
  AFTER_GUST,
  AFTERNOON_HOUR,
  alerts,
  forecast,
  GUST_AT,
  input,
  KMH,
  NOW,
  nwsAlert,
  OVERNIGHT_END,
  wind,
} from "./engine-test-fixtures";

it("explains a gust delay in one paragraph with the crossed cutoff and its margin", () => {
  const recommendation = evaluatePosture(
    input(["wind"], {
      now: AFTER_GUST,
      readings: [
        wind("windGust", KMH.mph63, GUST_AT),
        wind("windSpeed", KMH.mph37, GUST_AT),
      ],
      forecast: forecast([
        "2026-01-14T12:00:00Z",
        "2026-01-14T13:00:00Z",
        "10 mph",
      ]),
    }),
  );
  expect(recommendation.rationale).toBe(
    "Recommend a 2-hour delayed arrival on 2026-01-14: gusts 63 mph vs 58 mph cutoff, +5. The 05:00 decision deadline has passed. Confidence is medium. If onset moves 2 hours earlier, this becomes normal operations. If onset moves 2 hours later, this becomes a full closure.",
  );
});

it.each([
  { now: NOW, at: "2026-01-14T11:00:00.000Z", pastDeadline: false },
  { now: AFTER_GUST, at: "2026-01-14T11:00:00.000Z", pastDeadline: true },
  {
    now: "2026-01-14T23:00:00Z",
    at: "2026-01-15T11:00:00.000Z",
    pastDeadline: false,
  },
])("at $now the decision is due at $at", ({ now, at, pastDeadline }) => {
  expect(evaluatePosture(input(["winter"], { now })).decideBy).toEqual({
    at,
    local: "05:00",
    pastDeadline,
  });
});

it.each([
  {
    scenario: "an alert with a firm end",
    input: input(["winter"], {
      alerts: alerts(nwsAlert("Winter Weather Advisory", "Moderate")),
    }),
    confidence: { level: "high", reasons: [] },
  },
  {
    scenario: "an alert that gives only its expiry",
    input: input(["winter"], {
      alerts: alerts(
        nwsAlert(
          "Winter Weather Advisory",
          "Moderate",
          OVERNIGHT_END,
          "expires",
        ),
      ),
    }),
    confidence: {
      level: "medium",
      reasons: [{ kind: "endBasis", endBasis: "expires" }],
    },
  },
  {
    scenario: "a forecast-timed hazard with a stale observation",
    input: input(["wind"], {
      readings: [wind("windSpeed", KMH.mph12, "2026-01-14T06:30:00Z")],
      forecast: forecast([...AFTERNOON_HOUR, "40 mph"]),
    }),
    confidence: {
      level: "low",
      reasons: [
        { kind: "endBasis", endBasis: "forecast" },
        {
          kind: "stale",
          input: "observations",
          ageMinutes: 150,
          limitMinutes: 90,
        },
      ],
    },
  },
  {
    scenario: "a wind facility with no wind inputs",
    input: input(["wind"]),
    confidence: {
      level: "low",
      reasons: [
        { kind: "missing", input: "observations" },
        { kind: "missing", input: "forecast" },
      ],
    },
  },
])("rates confidence for $scenario", ({ input: engineInput, confidence }) => {
  expect(evaluatePosture(engineInput).confidence).toEqual(confidence);
});

it("reports what an onset two hours earlier or later would recommend", () => {
  const recommendation = evaluatePosture(
    input(["wind"], {
      forecast: forecast(
        [...AFTERNOON_HOUR, "35 to 45 mph"],
        ["2026-01-14T20:00:00Z", "2026-01-14T21:00:00Z", "40 mph"],
      ),
    }),
  );
  expect(recommendation.sensitivity).toEqual([
    {
      kind: "onsetShift",
      shiftMinutes: -120,
      status: {
        posture: "early_dismissal",
        departAt: "2026-01-14T15:45:00.000Z",
        departAtLocal: "09:45",
      },
    },
    {
      kind: "onsetShift",
      shiftMinutes: 120,
      status: {
        posture: "early_dismissal",
        departAt: "2026-01-14T19:45:00.000Z",
        departAtLocal: "13:45",
      },
    },
    {
      kind: "withoutFinding",
      hazard: "wind",
      cutoffId: "sustained",
      margin: {
        unit: "mph",
        metric: "wind_sustained",
        observed: 45,
        cutoff: 40,
        by: 5,
      },
      status: { posture: "normal" },
    },
  ]);
  expect(recommendation.rationale).toContain(
    "If onset moves 2 hours earlier, this becomes early dismissal at 09:45.",
  );
});
