import { expect, it } from "vitest";
import { parseFacilityId } from "./facility-id";

// Each one is a valid JavaScript number literal, so `Number` alone would read it as 1.
const DECIMAL_FACILITY_ID = 12;

const MALFORMED_IDS = ["0x1", "1e0", "01", " 1"] as const;

it.each(MALFORMED_IDS)("rejects facility id %j", (segment) => {
  expect(parseFacilityId(segment)).toBeUndefined();
});

it("reads a decimal facility id", () => {
  expect(parseFacilityId(String(DECIMAL_FACILITY_ID))).toBe(
    DECIMAL_FACILITY_ID,
  );
});
