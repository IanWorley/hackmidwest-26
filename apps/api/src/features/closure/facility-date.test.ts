import { recommendations } from "@hackmidwest/db";
import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { expect, it } from "vitest";
import { HTTP_NOT_FOUND, HTTP_OK } from "../../runtime";
import {
  ACCEPT,
  appRunner,
  BEFORE_DECIDED_AT,
  decide,
  FACILITY_DATE,
  FACILITY_ID,
  FIRST_DECISION_ID,
  RECOMMENDATION,
  UNKNOWN_ID,
} from "./decision-test-fixtures";
import { FACILITIES_PATH } from "./facilities";
import { contentHash } from "./records";

const withApp = appRunner(createTestDatabaseWithDemoFacilities);

const FACILITY_DATE_PATH = `${FACILITIES_PATH}/${FACILITY_ID}/facility-date`;
// Kansas City closes at 16:30 CDT, 21:30 UTC.
const CLOSING_TIME = "2026-10-02T21:30:00.000Z";
const NEXT_CLOSING_TIME = "2026-10-03T21:30:00.000Z";
const SAME_DAY_REEVALUATION = {
  ...RECOMMENDATION,
  evaluatedAt: BEFORE_DECIDED_AT,
  asOf: BEFORE_DECIDED_AT,
};

it("names the facility day and when it rolls over before anyone decides", async () => {
  await withApp(async ({ request }) => {
    const response = await request(FACILITY_DATE_PATH);

    expect(response.status).toBe(HTTP_OK);
    expect(await response.json()).toEqual({
      facilityDate: FACILITY_DATE,
      rollsOverAt: CLOSING_TIME,
      currentDecisionId: null,
    });
  });
});

it("moves to the next day and its closing time at closing time", async () => {
  await withApp(async ({ request }) => {
    const response = await request(FACILITY_DATE_PATH);

    expect(await response.json()).toEqual({
      facilityDate: "2026-10-03",
      rollsOverAt: NEXT_CLOSING_TIME,
      currentDecisionId: null,
    });
  }, CLOSING_TIME);
});

it("keeps the standing decision current after an undecided same-day re-evaluation", async () => {
  await withApp(async ({ db, request }) => {
    await request(decide(), ACCEPT);
    await db.insert(recommendations).values({
      ...SAME_DAY_REEVALUATION,
      contentHash: contentHash(SAME_DAY_REEVALUATION),
    });

    const response = await request(FACILITY_DATE_PATH);

    expect((await response.json()).currentDecisionId).toBe(FIRST_DECISION_ID);
  });
});

it("returns 404 for an id no facility has", async () => {
  await withApp(async ({ request }) => {
    const response = await request(
      `${FACILITIES_PATH}/${UNKNOWN_ID}/facility-date`,
    );

    expect(response.status).toBe(HTTP_NOT_FOUND);
  });
});
