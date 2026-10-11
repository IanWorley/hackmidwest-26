import { afterEach, expect, it, vi } from "vitest";
import { loadFacilityPersonnel } from "./load-facilities";

const FACILITY_ID = 1;
const TODAY = "2026-01-14";
const TOMORROW = "2026-01-15";
const TODAY_ROLLS_OVER_AT = "2026-01-14T23:00:00.000Z";
const TOMORROW_ROLLS_OVER_AT = "2026-01-15T23:00:00.000Z";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The first facility-date read lands after closing time while the roster read landed before it. */
function straddleClosingTimeOnce(): void {
  const facilityDays = [
    { facilityDate: TOMORROW, rollsOverAt: TOMORROW_ROLLS_OVER_AT },
    { facilityDate: TODAY, rollsOverAt: TODAY_ROLLS_OVER_AT },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/facility-date")) {
        return Promise.resolve(Response.json(facilityDays.shift()));
      }
      if (path.endsWith("/personnel")) {
        return Promise.resolve(Response.json({ facilityDate: TODAY }));
      }
      return Promise.resolve(Response.json({ id: FACILITY_ID }));
    }),
  );
}

it("reads the roster again when its facility day and the rollover's disagree", async () => {
  straddleClosingTimeOnce();

  const loaded = await loadFacilityPersonnel({
    facilityId: String(FACILITY_ID),
    signal: new AbortController().signal,
  });

  expect(loaded.rollsOverAt).toBe(TODAY_ROLLS_OVER_AT);
});
