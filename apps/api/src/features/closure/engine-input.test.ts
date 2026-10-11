import { Value } from "@sinclair/typebox/value";
import { expect, it } from "vitest";
import { EngineInputSchema } from "./engine-input";
import { CREST_FT, input, river } from "./engine-test-fixtures";

it("rejects a gauge whose flood stages are not numbers in feet", () => {
  const gauge = river(CREST_FT.atModerate);
  const valid = input(["flood"], { gauge });
  const mistyped = {
    ...valid,
    gauge: { ...gauge, floodStagesFt: { moderate: "35 ft" } },
  };

  expect([
    Value.Check(EngineInputSchema, valid),
    Value.Check(EngineInputSchema, mistyped),
  ]).toEqual([true, false]);
});
