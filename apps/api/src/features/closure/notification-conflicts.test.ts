import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { expect, it } from "vitest";
import { HTTP_CONFLICT, HTTP_CREATED } from "../../runtime";
import {
  ACCEPT,
  appRunner,
  DEFER,
  decide,
  FIRST_DECISION_ID,
  NEWER_RECOMMENDATION_ID,
  OVERRIDE,
  SECOND_DECISION_ID,
} from "./decision-test-fixtures";
import {
  CLEAR,
  dispatch,
  dispatchCount,
  notifications,
  recommend,
  STORM,
} from "./notification-route-test-fixtures";

const withApp = appRunner(createTestDatabaseWithDemoFacilities);

it.each([
  { route: "notifications", path: notifications(), body: undefined },
  { route: "dispatch", path: dispatch(), body: {} },
])(
  "refuses $route for a deferral, which sets no posture",
  async ({ path, body }) => {
    await withApp(async ({ db, request }) => {
      await recommend(db, STORM);
      await request(decide(NEWER_RECOMMENDATION_ID), DEFER);

      const response = await request(path, body);

      expect([response.status, await response.json()]).toEqual([
        HTTP_CONFLICT,
        {
          conflict: "no_posture",
          message:
            "This decision sets no posture, so there is nothing to notify",
          action: "defer",
        },
      ]);
    });
  },
);

it("refuses to dispatch a decision a later decision supersedes", async () => {
  await withApp(async ({ db, request }) => {
    await recommend(db, STORM);
    await request(decide(NEWER_RECOMMENDATION_ID), ACCEPT);
    await request(decide(NEWER_RECOMMENDATION_ID), {
      ...OVERRIDE,
      chosenPosture: "unscheduled_telework",
      supersedesDecisionId: FIRST_DECISION_ID,
    });

    const response = await request(dispatch(FIRST_DECISION_ID), {});

    expect([
      response.status,
      await response.json(),
      await dispatchCount(db),
    ]).toEqual([
      HTTP_CONFLICT,
      {
        conflict: "not_current_decision",
        message: "Only the facility's current decision can be dispatched",
        currentDecisionId: SECOND_DECISION_ID,
      },
      0,
    ]);
  });
});

it("refuses to dispatch a decision once the facility has decided on a newer recommendation", async () => {
  await withApp(async ({ db, request }) => {
    await recommend(db, STORM);
    await request(decide(NEWER_RECOMMENDATION_ID), ACCEPT);
    await recommend(db, CLEAR);
    await request(decide(NEWER_RECOMMENDATION_ID + 1), ACCEPT);

    const response = await request(dispatch(FIRST_DECISION_ID), {});

    expect([
      response.status,
      await response.json(),
      await dispatchCount(db),
    ]).toEqual([
      HTTP_CONFLICT,
      {
        conflict: "not_current_decision",
        message: "Only the facility's current decision can be dispatched",
        currentDecisionId: SECOND_DECISION_ID,
      },
      0,
    ]);
  });
});

it("dispatches a package with nobody to tell without recording a row", async () => {
  await withApp(async ({ db, request }) => {
    await recommend(db, CLEAR);
    await request(decide(NEWER_RECOMMENDATION_ID), ACCEPT);

    const response = await request(dispatch(), {});
    const body = await response.json();

    expect([
      response.status,
      body.package.recipients,
      body.dispatches,
      await dispatchCount(db),
    ]).toEqual([HTTP_CREATED, [], [], 0]);
  });
});
