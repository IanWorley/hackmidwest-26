import { expect, it } from "vitest";
import { staleInputs } from "./freshness";

it("names each input older than its limit and passes fresh ones", () => {
  const stale = staleInputs(
    [
      { input: "observations", asOf: "2026-01-14T07:00:00Z" },
      { input: "forecast", asOf: "2026-01-14T06:00:00Z" },
    ],
    "2026-01-14T09:00:00Z",
  );
  expect(stale).toEqual([
    { input: "observations", ageMinutes: 120, limitMinutes: 90 },
  ]);
});
