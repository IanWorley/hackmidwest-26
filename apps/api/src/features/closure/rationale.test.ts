import { expect, it } from "vitest";
import { evaluatePosture } from "./engine";
import {
  alert,
  CALM_GUST_KMH,
  engineInput,
  GUST_AT_CUTOFF_KMH,
  gust,
  WIND_40_AT_1300,
  withGustDuringArrival,
} from "./engine-test-fixtures";

it("writes a one-paragraph rationale citing the crossed cutoff, confidence, and deadline", () => {
  const result = evaluatePosture(engineInput({ forecast: WIND_40_AT_1300 }));
  expect([result.decideBy, result.rationale]).toEqual([
    "2026-01-14T11:00:00.000Z",
    "Recommend early dismissal at 11:45 for 2026-01-14. Wind is forecast to reach 40 mph against the 40 mph sustained wind cutoff (+0), per National Weather Service, NWSI 10-515 WFO Non-Precipitation Weather Products Specification (May 16, 2025). Timed against the facility day, it calls for early dismissal at 11:45. This drives the recommendation. Confidence is medium: the hazard's end comes from forecast hours or a single reading. Decide by 05:00 local time.",
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
    "Recommend normal operations for 2026-01-14. Winter weather reached Severe severity against the Severe severity winter storm warning cutoff (+0), per National Weather Service, NWSI 10-513 WFO Winter Weather Products Specification (November 6, 2024), with OASIS CAP v1.2 severity as served by api.weather.gov. Timed against the facility day, it calls for normal operations. Confidence is high. Decide by 05:00 local time.",
  );
});

it("says a missing reading is missing and names its cutoff in words", () => {
  expect(
    evaluatePosture(engineInput({ readings: [gust(CALM_GUST_KMH)] })).rationale,
  ).toBe(
    "Recommend normal operations for 2026-01-14. No hazard crossed a cutoff. Confidence is low: the reading for the unhealthy air quality cutoff is missing; the reading for the very unhealthy air quality cutoff is missing. Decide by 05:00 local time.",
  );
});

it("says an observed gust reached its value", () => {
  expect(
    evaluatePosture(withGustDuringArrival(GUST_AT_CUTOFF_KMH)).rationale,
  ).toBe(
    "Recommend a 2-hour delayed arrival for 2026-01-14. Wind reached 58 mph against the 58 mph wind gust cutoff (+0), per National Weather Service, NWSI 10-515 WFO Non-Precipitation Weather Products Specification (May 16, 2025). Timed against the facility day, it calls for a 2-hour delayed arrival. This drives the recommendation. Confidence is medium: the hazard's end comes from forecast hours or a single reading. Decide by 05:00 local time; that deadline has passed.",
  );
});
