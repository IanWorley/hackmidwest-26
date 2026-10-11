import { expect, it } from "vitest";
import { evaluatePosture } from "./engine";
import {
  ALL_DAY_END,
  alerts,
  CREST_FT,
  crossed,
  input,
  nwsAlert,
  river,
} from "./engine-test-fixtures";

it.each([
  {
    scenario: "a Severe Flood Warning moves to telework",
    input: input(["flood"], {
      alerts: alerts(nwsAlert("Flood Warning", "Severe", ALL_DAY_END)),
    }),
    status: { posture: "unscheduled_telework" },
    crossed: ["flood/warning"],
  },
  {
    scenario: "a Minor Flood Warning crosses nothing",
    input: input(["flood"], {
      alerts: alerts(nwsAlert("Flood Warning", "Minor", ALL_DAY_END)),
    }),
    status: { posture: "normal" },
    crossed: [],
  },
  {
    scenario: "a crest just under the 35 ft moderate stage crosses nothing",
    input: input(["flood"], { gauge: river(CREST_FT.justUnderModerate) }),
    status: { posture: "normal" },
    crossed: [],
  },
  {
    scenario: "a crest at the 35 ft moderate stage moves to telework",
    input: input(["flood"], { gauge: river(CREST_FT.atModerate) }),
    status: { posture: "unscheduled_telework" },
    crossed: ["flood/moderateFlood"],
  },
  {
    scenario: "a crest just under the 49 ft major stage stays at telework",
    input: input(["flood"], { gauge: river(CREST_FT.justUnderMajor) }),
    status: { posture: "unscheduled_telework" },
    crossed: ["flood/moderateFlood"],
  },
  {
    scenario: "a crest at the 49 ft major stage closes",
    input: input(["flood"], { gauge: river(CREST_FT.atMajor) }),
    status: { posture: "full_closure" },
    crossed: ["flood/majorFlood", "flood/moderateFlood"],
  },
])("$scenario", ({ input: engineInput, status, crossed: expected }) => {
  const recommendation = evaluatePosture(engineInput);
  expect({
    status: recommendation.status,
    crossed: crossed(recommendation),
  }).toEqual({ status, crossed: expected });
});

it("states a gauge crossing as the crest against the gauge's own flood stage", () => {
  const [deciding] = evaluatePosture(
    input(["flood"], { gauge: river(CREST_FT.pastMajor) }),
  ).findings;
  expect(deciding?.margin).toEqual({
    unit: "nws_flood_category",
    category: "major",
    observed: 49.2,
    cutoff: 49,
    by: 0.2,
  });
});

it("does not mark a flood facility without a gauge as missing an input", () => {
  expect(evaluatePosture(input(["flood"])).confidence).toEqual({
    level: "high",
    reasons: [],
  });
});

it("lowers confidence when a supplied gauge's observation is stale", () => {
  expect(
    evaluatePosture(
      input(["flood"], {
        gauge: river(CREST_FT.belowModerate, "2026-01-14T02:00:00Z"),
      }),
    ).confidence,
  ).toEqual({
    level: "low",
    reasons: [
      { kind: "stale", input: "gauge", ageMinutes: 420, limitMinutes: 360 },
    ],
  });
});
