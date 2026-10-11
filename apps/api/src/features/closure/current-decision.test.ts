import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { expect, it } from "vitest";
import { findCurrentDecision } from "./current-decision";
import {
  ACCEPT,
  appRunner,
  BEFORE_DECIDED_AT,
  DECIDED_AT,
  decide,
  FACILITY_DATE,
  FACILITY_ID,
  FIRST_DECISION_ID,
  RECOMMENDATION_ID,
  UNKNOWN_ID,
} from "./decision-test-fixtures";
import { parseInstant } from "./zoned-time";

const withApp = appRunner(createTestDatabaseWithDemoFacilities);

// Kansas City closes at 16:30 CDT, 21:30 UTC, so the facility day becomes October 3.
const AFTER_CLOSING = "2026-10-02T21:30:00.000Z";

it("names the facility day and the decision standing on it", async () => {
  await withApp(async ({ db, request }) => {
    await request(decide(), ACCEPT);

    expect(
      await findCurrentDecision(db, FACILITY_ID, parseInstant(DECIDED_AT)),
    ).toEqual({
      facilityDate: FACILITY_DATE,
      decision: {
        id: FIRST_DECISION_ID,
        recommendationId: RECOMMENDATION_ID,
        action: "accept",
        chosenPosture: "delayed_arrival",
        decidedAt: DECIDED_AT,
      },
    });
  });
});

it.each([
  { case: "before the decision", now: BEFORE_DECIDED_AT, day: FACILITY_DATE },
  { case: "at closing time", now: AFTER_CLOSING, day: "2026-10-03" },
])("has no current decision $case", async ({ now, day }) => {
  await withApp(async ({ db, request }) => {
    await request(decide(), ACCEPT);

    expect(
      await findCurrentDecision(db, FACILITY_ID, parseInstant(now)),
    ).toEqual({ facilityDate: day, decision: null });
  });
});

it("answers null for an unknown facility", async () => {
  await withApp(async ({ db }) => {
    expect(
      await findCurrentDecision(db, UNKNOWN_ID, parseInstant(DECIDED_AT)),
    ).toBeNull();
  });
});
