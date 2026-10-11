import { expect, it } from "vitest";
import { evaluatePosture } from "./engine";
import {
  alert,
  aqi,
  CALM_GUST_KMH,
  CLEAN_AQI,
  engineInput,
  forecastOf,
  forecastPeriod,
  gust,
  STORM_ALL_DAY,
} from "./engine-test-fixtures";

const STORM_TODAY = alert("Winter Storm Warning", "Severe", STORM_ALL_DAY);
const STORM_TONIGHT = alert("Winter Storm Warning", "Extreme", [
  "2026-01-15T02:00:00Z",
  "2026-01-15T06:00:00Z",
]);
const FUTURE_GUST_KMH = 120;

it.each([
  { order: "today's warning first", alerts: [STORM_TODAY, STORM_TONIGHT] },
  { order: "tonight's warning first", alerts: [STORM_TONIGHT, STORM_TODAY] },
])(
  "closes for today's storm even when a more severe one tonight is listed ($order)",
  ({ alerts }) => {
    const result = evaluatePosture(engineInput({ alerts }));
    expect([result.status, result.driver?.timing.hazardWindow.start]).toEqual([
      { posture: "full_closure" },
      "2026-01-14T06:00:00.000Z",
    ]);
  },
);

it("ignores a reading stamped after the evaluation time", () => {
  const result = evaluatePosture(
    engineInput({
      readings: [
        gust(CALM_GUST_KMH),
        gust(FUTURE_GUST_KMH, "2026-01-14T12:30:00Z"),
        aqi(CLEAN_AQI),
      ],
    }),
  );
  const gustCheck = result.hazards
    .find(({ hazard }) => hazard === "wind")
    ?.checks.find(({ cutoff }) => cutoff === "gust");
  expect(gustCheck?.outcome).toMatchObject({ kind: "below", observed: 12.4 });
});

it("times separate windy hours as separate windows instead of one long one", () => {
  const result = evaluatePosture(
    engineInput({
      forecast: forecastOf([
        forecastPeriod(
          "2026-01-14T13:00:00Z",
          "2026-01-14T14:00:00Z",
          "40 mph",
        ),
        forecastPeriod(
          "2026-01-14T20:00:00Z",
          "2026-01-14T21:00:00Z",
          "40 mph",
        ),
      ]),
    }),
  );
  expect(result.status).toEqual({
    posture: "early_dismissal",
    departAt: "2026-01-14T18:45:00.000Z",
    departAtLocal: "12:45",
  });
});
