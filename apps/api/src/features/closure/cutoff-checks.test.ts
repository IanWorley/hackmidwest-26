import { expect, it } from "vitest";
import { type EngineInput, evaluatePosture } from "./engine";
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
import type { Reading } from "./readings";

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

const TIED_INSTANT = "2026-01-14T08:30:00Z";
const LIGHT_GUST_KMH = 30;
const STRONG_GUST_KMH = 90;
const DAMAGING_GUST_KMH = 120;
const EARLIER_STORM = alert("Winter Storm Warning", "Severe", [
  "2026-01-14T05:00:00Z",
  "2026-01-15T03:00:00Z",
]);

function tiedGust(kmh: number, rawRef: string): Reading {
  return { ...gust(kmh, TIED_INSTANT), rawRef };
}

function permutations<Item>(items: readonly Item[]): Item[][] {
  if (items.length <= 1) {
    return [[...items]];
  }
  return items.flatMap((item, index) =>
    permutations(items.filter((_, other) => other !== index)).map((rest) => [
      item,
      ...rest,
    ]),
  );
}

function reorderings(input: EngineInput): EngineInput[] {
  return permutations(input.readings).flatMap((readings) =>
    permutations(input.alerts).map((alerts) => ({
      ...input,
      readings,
      alerts,
    })),
  );
}

const TIE_ROWS = [
  {
    scenario: "two gusts at the same instant report the larger",
    input: engineInput({
      readings: [
        tiedGust(LIGHT_GUST_KMH, "obs-a"),
        tiedGust(STRONG_GUST_KMH, "obs-b"),
        aqi(CLEAN_AQI),
      ],
    }),
    check: ["wind", "gust"],
    outcome: { kind: "below", observed: 55.9, input: { ref: "obs-b" } },
  },
  {
    scenario: "two gusts at the same instant cross on the larger",
    input: engineInput({
      readings: [
        tiedGust(LIGHT_GUST_KMH, "obs-a"),
        tiedGust(DAMAGING_GUST_KMH, "obs-b"),
        aqi(CLEAN_AQI),
      ],
    }),
    check: ["wind", "gust"],
    outcome: { kind: "crossed", observed: 74.6, input: { ref: "obs-b" } },
  },
  {
    scenario: "two Severe Winter Storm Warnings resolve by alert id",
    input: engineInput({ alerts: [STORM_TODAY, EARLIER_STORM] }),
    check: ["winter", "stormWarning"],
    outcome: {
      kind: "crossed",
      input: { ref: "Winter Storm Warning-Severe-2026-01-14T05:00:00Z" },
    },
  },
  {
    scenario:
      "two Moderate Winter Storm Warnings below the cutoff resolve by alert id",
    input: engineInput({
      alerts: [
        alert("Winter Storm Warning", "Moderate", STORM_ALL_DAY),
        alert("Winter Storm Warning", "Moderate", [
          "2026-01-14T05:00:00Z",
          "2026-01-15T03:00:00Z",
        ]),
      ],
    }),
    check: ["winter", "stormWarning"],
    outcome: {
      kind: "below",
      input: { ref: "Winter Storm Warning-Moderate-2026-01-14T05:00:00Z" },
    },
  },
] as const;

it.each(TIE_ROWS)(
  "gives a deep-equal recommendation for every input order when $scenario",
  ({ input, check: [hazard, cutoff], outcome }) => {
    const recommendations = reorderings(input).map(evaluatePosture);
    const [canonical] = recommendations;
    for (const recommendation of recommendations) {
      expect(recommendation).toStrictEqual(canonical);
    }
    const tiedCheck = canonical?.hazards
      .find((assessment) => assessment.hazard === hazard)
      ?.checks.find((candidate) => candidate.cutoff === cutoff);
    expect(tiedCheck?.outcome).toMatchObject(outcome);
  },
);
