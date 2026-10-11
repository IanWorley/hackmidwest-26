import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { expect, it } from "vitest";
import {
  HTTP_CREATED,
  HTTP_NOT_FOUND,
  HTTP_UNPROCESSABLE_ENTITY,
} from "../../runtime";
import {
  ACCEPT,
  AFTER_DECIDE_BY,
  appRunner,
  DECIDE_BY,
  DECIDED_AT,
  DECIDER_ID,
  DEFER,
  decide,
  FACILITY_ID,
  FIRST_DECISION_ID,
  HALF_MINUTE_LATE,
  OVERRIDE,
  RECHECK_AT,
  RECOMMENDATION_HASH,
  RECOMMENDATION_ID,
  SHA256_HEX,
  storedDecisions,
  UNKNOWN_ID,
} from "./decision-test-fixtures";

const withApp = appRunner(createTestDatabaseWithDemoFacilities);

it.each([
  {
    body: ACCEPT,
    columns: {
      action: "accept",
      chosenPosture: "delayed_arrival",
      recheckAt: null,
      reasonCategory: null,
      reasonText: null,
    },
  },
  {
    body: OVERRIDE,
    columns: {
      action: "override",
      chosenPosture: "full_closure",
      recheckAt: null,
      reasonCategory: "road_reports",
      reasonText: "County reports the highway closed.",
    },
  },
  {
    body: DEFER,
    columns: {
      action: "defer",
      chosenPosture: null,
      recheckAt: RECHECK_AT,
      reasonCategory: "road_reports",
      reasonText: "County reports the highway closed.",
    },
  },
])(
  "records $body.action as a row linked to the recommendation it saw",
  async ({ body, columns }) => {
    await withApp(async ({ db, request }) => {
      const response = await request(decide(), body);

      expect(response.status).toBe(HTTP_CREATED);
      expect(await storedDecisions(db)).toEqual([
        {
          id: FIRST_DECISION_ID,
          recommendationId: RECOMMENDATION_ID,
          recommendationHash: RECOMMENDATION_HASH,
          facilityId: FACILITY_ID,
          ...columns,
          decidedById: DECIDER_ID,
          decidedByName: "Dana Whitfield",
          decidedByRole: "County Executive Director",
          decidedAt: DECIDED_AT,
          identityVerified: false,
          supersedesDecisionId: null,
          contentHash: expect.stringMatching(SHA256_HEX),
        },
      ]);
    });
  },
);

it.each([
  { now: DECIDED_AT, minutes: 30 },
  { now: HALF_MINUTE_LATE, minutes: -1 },
])(
  "reports a decision at $now as $minutes minutes before decideBy",
  async ({ now, minutes }) => {
    await withApp(async ({ request }) => {
      const response = await request(decide(), ACCEPT);

      expect(await response.json()).toMatchObject({
        decidedAt: now,
        minutesBeforeDecideBy: minutes,
      });
    }, now);
  },
);

it.each([
  {
    action: "override",
    chosenPosture: "full_closure",
    decidedById: DECIDER_ID,
  },
  { action: "defer", recheckAt: RECHECK_AT, decidedById: DECIDER_ID },
])(
  "rejects $action without a reason, naming the reason field",
  async (body) => {
    await withApp(async ({ db, request }) => {
      const response = await request(decide(), body);

      expect([
        response.status,
        await response.json(),
        await storedDecisions(db),
      ]).toEqual([
        HTTP_UNPROCESSABLE_ENTITY,
        {
          type: "validation",
          on: "body",
          property: "/reason",
          message: "Expected required property",
        },
        [],
      ]);
    });
  },
);

it("rejects an override to the recommended posture", async () => {
  await withApp(async ({ request }) => {
    const response = await request(decide(), {
      ...OVERRIDE,
      chosenPosture: "delayed_arrival",
    });

    expect([response.status, await response.json()]).toEqual([
      HTTP_UNPROCESSABLE_ENTITY,
      {
        type: "validation",
        on: "body",
        property: "/chosenPosture",
        message:
          "An override must choose a posture other than the recommended one",
      },
    ]);
  });
});

it.each([DECIDE_BY, AFTER_DECIDE_BY])(
  "rejects a deferral that rechecks at %s, not before decideBy",
  async (recheckAt) => {
    await withApp(async ({ request }) => {
      const response = await request(decide(), { ...DEFER, recheckAt });

      expect([response.status, await response.json()]).toEqual([
        HTTP_UNPROCESSABLE_ENTITY,
        {
          type: "validation",
          on: "body",
          property: "/recheckAt",
          message:
            "A deferral must recheck before the recommendation's decideBy",
        },
      ]);
    });
  },
);

it("rejects a decider who is not a decision maker", async () => {
  await withApp(async ({ request }) => {
    const response = await request(decide(), {
      ...ACCEPT,
      decidedById: UNKNOWN_ID,
    });

    expect([response.status, await response.json()]).toEqual([
      HTTP_UNPROCESSABLE_ENTITY,
      {
        type: "validation",
        on: "body",
        property: "/decidedById",
        message: "No decision maker has this id",
      },
    ]);
  });
});

it("returns 404 for a recommendation that does not exist", async () => {
  await withApp(async ({ request }) => {
    const response = await request(decide(UNKNOWN_ID), ACCEPT);

    expect([response.status, await response.json()]).toEqual([
      HTTP_NOT_FOUND,
      { message: "Recommendation not found" },
    ]);
  });
});
