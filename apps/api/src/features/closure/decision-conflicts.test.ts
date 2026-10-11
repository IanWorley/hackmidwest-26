import {
  decisions,
  notificationDispatches,
  recommendations,
} from "@hackmidwest/db";
import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { expect, it } from "vitest";
import {
  HTTP_CONFLICT,
  HTTP_CREATED,
  HTTP_UNPROCESSABLE_ENTITY,
} from "../../runtime";
import {
  ACCEPT,
  appRunner,
  decide,
  FIRST_DECISION_ID,
  NEWER_RECOMMENDATION_ID,
  OVERRIDE,
  RECOMMENDATION,
  RECOMMENDATION_ID,
  storedDecisions,
  UNKNOWN_ID,
} from "./decision-test-fixtures";
import { contentHash } from "./records";

const withApp = appRunner(createTestDatabaseWithDemoFacilities);
const EARLIER_EVALUATED_AT = "2026-10-02T09:30:00.000Z";
const STORED_LAST_ID = 2;

it("refuses a decision on a recommendation the facility has since replaced", async () => {
  await withApp(async ({ db, request }) => {
    await db.insert(recommendations).values({
      ...RECOMMENDATION,
      posture: "full_closure",
      contentHash: contentHash({
        ...RECOMMENDATION,
        posture: "full_closure",
      }),
    });

    const response = await request(decide(), ACCEPT);

    expect([response.status, await response.json()]).toEqual([
      HTTP_CONFLICT,
      {
        conflict: "newer_recommendation",
        latestRecommendationId: NEWER_RECOMMENDATION_ID,
      },
    ]);
  });
});

it("treats the evaluation with the newest evaluatedAt as current, even when an older one was stored after it", async () => {
  await withApp(async ({ db, request }) => {
    const older = {
      ...RECOMMENDATION,
      evaluatedAt: EARLIER_EVALUATED_AT,
      asOf: EARLIER_EVALUATED_AT,
    };
    await db
      .insert(recommendations)
      .values({ ...older, contentHash: contentHash(older) });

    const onOlder = await request(decide(STORED_LAST_ID), ACCEPT);
    const onNewer = await request(decide(), ACCEPT);

    expect([
      onOlder.status,
      await onOlder.json(),
      onNewer.status,
      (await storedDecisions(db)).map(
        ({ recommendationId }) => recommendationId,
      ),
    ]).toEqual([
      HTTP_CONFLICT,
      {
        conflict: "newer_recommendation",
        latestRecommendationId: RECOMMENDATION_ID,
      },
      HTTP_CREATED,
      [RECOMMENDATION_ID],
    ]);
  });
});

it.each([
  { name: "omits supersedesDecisionId", supersedes: {} },
  {
    name: "supersedes a decision outside the chain",
    supersedes: { supersedesDecisionId: UNKNOWN_ID },
  },
])("refuses a second decision that $name", async ({ supersedes }) => {
  await withApp(async ({ request }) => {
    await request(decide(), ACCEPT);

    const response = await request(decide(), { ...OVERRIDE, ...supersedes });

    expect([response.status, await response.json()]).toEqual([
      HTTP_CONFLICT,
      { conflict: "newer_decision", latestDecisionId: FIRST_DECISION_ID },
    ]);
  });
});

it("refuses to supersede when the recommendation has no decision yet", async () => {
  await withApp(async ({ request }) => {
    const response = await request(decide(), {
      ...OVERRIDE,
      supersedesDecisionId: FIRST_DECISION_ID,
    });

    expect([response.status, await response.json()]).toEqual([
      HTTP_CONFLICT,
      { conflict: "newer_decision", latestDecisionId: null },
    ]);
  });
});

it("records a changed decision as a new row superseding the newest one", async () => {
  await withApp(async ({ db, request }) => {
    await request(decide(), ACCEPT);

    const response = await request(decide(), {
      ...OVERRIDE,
      supersedesDecisionId: FIRST_DECISION_ID,
    });

    expect(response.status).toBe(HTTP_CREATED);
    expect(
      (await storedDecisions(db)).map(
        ({ id, action, supersedesDecisionId }) => ({
          id,
          action,
          supersedesDecisionId,
        }),
      ),
    ).toEqual([
      { id: 1, action: "accept", supersedesDecisionId: null },
      { id: 2, action: "override", supersedesDecisionId: FIRST_DECISION_ID },
    ]);
  });
});

it("rejects changing a decision without a reason, even to accept", async () => {
  await withApp(async ({ request }) => {
    await request(decide(), OVERRIDE);

    const response = await request(decide(), {
      ...ACCEPT,
      supersedesDecisionId: FIRST_DECISION_ID,
    });

    expect([response.status, await response.json()]).toEqual([
      HTTP_UNPROCESSABLE_ENTITY,
      {
        type: "validation",
        on: "body",
        property: "/reason",
        message: "Changing a decision requires a reason",
      },
    ]);
  });
});

it("records a decision without dispatching any notification", async () => {
  await withApp(async ({ db, request }) => {
    await request(decide(), ACCEPT);

    expect([
      (await db.select().from(decisions)).length,
      await db.select().from(notificationDispatches),
    ]).toEqual([1, []]);
  });
});
