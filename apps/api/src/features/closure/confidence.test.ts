import { describe, expect, it } from "vitest";
import { evaluatePosture } from "./engine";
import {
  alert,
  aqi,
  CALM_GUST_KMH,
  CLEAN_AQI,
  ENDS_0300_LOCAL,
  engineInput,
  gust,
} from "./engine-test-fixtures";

describe("confidence", () => {
  it("is high with fresh inputs and no crossing", () => {
    const result = evaluatePosture(engineInput());
    expect([result.confidence, result.caveats]).toEqual(["high", []]);
  });

  it("drops to low when an observation is older than its limit", () => {
    const result = evaluatePosture(
      engineInput({
        readings: [gust(CALM_GUST_KMH, "2026-01-14T07:00:00Z"), aqi(CLEAN_AQI)],
      }),
    );
    expect([result.confidence, result.caveats]).toEqual([
      "low",
      [
        {
          kind: "staleInput",
          input: "observations",
          ageMinutes: 120,
          limitMinutes: 90,
        },
      ],
    ]);
  });

  it("drops to medium when the driving alert's end is only its expiry", () => {
    const result = evaluatePosture(
      engineInput({
        alerts: [
          alert(
            "Winter Weather Advisory",
            "Moderate",
            ENDS_0300_LOCAL,
            "expires",
          ),
        ],
      }),
    );
    expect([result.confidence, result.caveats]).toEqual([
      "medium",
      [{ kind: "estimatedEnd", endBasis: "expires" }],
    ]);
  });

  it("drops to low when a profiled hazard has no reading", () => {
    const result = evaluatePosture(
      engineInput({ readings: [gust(CALM_GUST_KMH)] }),
    );
    expect([result.confidence, result.caveats]).toEqual([
      "low",
      [
        { kind: "missingReading", hazard: "airQuality", cutoff: "unhealthy" },
        {
          kind: "missingReading",
          hazard: "airQuality",
          cutoff: "veryUnhealthy",
        },
      ],
    ]);
  });
});
