import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { expect, it } from "vitest";
import { HTTP_CONFLICT, HTTP_CREATED } from "../../runtime";
import {
  AFTER_DECIDE_BY,
  EVALUATE_PATH,
  storedDecisions,
  type TestApp,
  withStormAppOn,
} from "./recommendation-test-app";

const DECISION_MAKER_ID = 1;
const FIRST_RECOMMENDATION_ID = 1;
const PREVIEW_RECOMMENDATION_ID = 2;
const DAY_BEFORE_AS_OF = "2026-01-13T09:00:00.000Z";
const NEXT_MORNING_AS_OF = "2026-01-15T10:30:00.000Z";
const ACCEPT = { action: "accept", decidedById: DECISION_MAKER_ID } as const;

function withApp(run: (app: TestApp) => Promise<void>): Promise<void> {
  return withStormAppOn(createTestDatabaseWithDemoFacilities, run);
}

it(`POST ${EVALUATE_PATH} with an asOf records no missed decision, even after decideBy, because a preview never touches the decision chain`, async () => {
  await withApp(async ({ db, post, setClock }) => {
    await post(EVALUATE_PATH);
    setClock(AFTER_DECIDE_BY);

    const response = await post(EVALUATE_PATH, { asOf: NEXT_MORNING_AS_OF });

    expect([response.status, await storedDecisions(db)]).toEqual([
      HTTP_CREATED,
      [],
    ]);
  });
});

it(`POST ${EVALUATE_PATH} after a backdated preview records no missed decision against the preview`, async () => {
  await withApp(async ({ db, post }) => {
    await post(EVALUATE_PATH, { asOf: DAY_BEFORE_AS_OF });

    const response = await post(EVALUATE_PATH);

    expect([response.status, await storedDecisions(db)]).toEqual([
      HTTP_CREATED,
      [],
    ]);
  });
});

it("a live recommendation stays decidable after a later preview", async () => {
  await withApp(async ({ post }) => {
    await post(EVALUATE_PATH);
    await post(EVALUATE_PATH, { asOf: NEXT_MORNING_AS_OF });

    const decided = await post(
      `/api/recommendations/${FIRST_RECOMMENDATION_ID}/decisions`,
      ACCEPT,
    );

    expect(decided.status).toBe(HTTP_CREATED);
  });
});

it("deciding on a preview is refused with a conflict naming the live recommendation, and nothing is stored", async () => {
  await withApp(async ({ db, post }) => {
    await post(EVALUATE_PATH);
    await post(EVALUATE_PATH, { asOf: NEXT_MORNING_AS_OF });

    const decided = await post(
      `/api/recommendations/${PREVIEW_RECOMMENDATION_ID}/decisions`,
      ACCEPT,
    );

    expect([
      decided.status,
      await decided.json(),
      await storedDecisions(db),
    ]).toEqual([
      HTTP_CONFLICT,
      {
        conflict: "preview_recommendation",
        latestRecommendationId: FIRST_RECOMMENDATION_ID,
      },
      [],
    ]);
  });
});
