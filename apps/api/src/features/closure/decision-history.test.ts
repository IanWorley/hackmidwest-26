import { notificationDispatches, recommendations } from "@hackmidwest/db";
import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { expect, it } from "vitest";
import { HTTP_NOT_FOUND, HTTP_OK } from "../../runtime";
import {
  ACCEPT,
  appRunner,
  DECIDED_AT,
  decide,
  EMPLOYEE_ID,
  FACILITY_ID,
  FIRST_DECISION_ID,
  NEWER_RECOMMENDATION_ID,
  OVERRIDE,
  RECHECK_AT,
  RECOMMENDATION,
  storedDecisions,
  UNKNOWN_ID,
} from "./decision-test-fixtures";
import { contentHash } from "./records";

const withApp = appRunner(createTestDatabaseWithDemoFacilities);

it("returns the facility's decisions newest first with their human inputs", async () => {
  await withApp(async ({ request }) => {
    await request(decide(), {
      ...ACCEPT,
      humanInputs: [
        {
          reportedBy: "Night shift supervisor",
          reportedAt: RECHECK_AT,
          text: "The north lot has not been plowed.",
        },
      ],
    });
    await request(decide(), {
      ...OVERRIDE,
      supersedesDecisionId: FIRST_DECISION_ID,
    });

    const response = await request(`/api/facilities/${FACILITY_ID}/decisions`);

    expect(response.status).toBe(HTTP_OK);
    const history: {
      id: number;
      action: string;
      humanInputs: unknown[];
    }[] = await response.json();
    expect(
      history.map(({ id, action, humanInputs: inputs }) => ({
        id,
        action,
        humanInputs: inputs,
      })),
    ).toEqual([
      { id: 2, action: "override", humanInputs: [] },
      {
        id: 1,
        action: "accept",
        humanInputs: [
          {
            id: 1,
            decisionId: 1,
            reportedBy: "Night shift supervisor",
            reportedAt: RECHECK_AT,
            text: "The north lot has not been plowed.",
          },
        ],
      },
    ]);
  });
});

it("returns 404 for a facility that does not exist", async () => {
  await withApp(async ({ request }) => {
    const response = await request(`/api/facilities/${UNKNOWN_ID}/decisions`);

    expect([response.status, await response.json()]).toEqual([
      HTTP_NOT_FOUND,
      { message: "Facility not found" },
    ]);
  });
});

it("reports an untouched chain through to its dispatch as intact", async () => {
  await withApp(async ({ db, request }) => {
    await request(decide(), ACCEPT);
    const [decision] = await storedDecisions(db);
    const dispatch = {
      decisionId: FIRST_DECISION_ID,
      decisionHash: decision?.contentHash ?? "",
      employeeId: EMPLOYEE_ID,
      channel: "email",
      sendBy: RECHECK_AT,
      recordedAt: DECIDED_AT,
    } as const;
    await db
      .insert(notificationDispatches)
      .values({ ...dispatch, contentHash: contentHash(dispatch) });

    const response = await request(
      `/api/decisions/${FIRST_DECISION_ID}/verify`,
    );

    expect(await response.json()).toEqual({
      decisionId: 1,
      intact: true,
      breaks: [],
    });
  });
});

it("reports a recommendation whose stored hash does not match its content", async () => {
  await withApp(async ({ db, request }) => {
    const tamperedId = NEWER_RECOMMENDATION_ID;
    // The decision copies the wrong hash faithfully, which satisfies the database trigger.
    await db.insert(recommendations).values({
      ...RECOMMENDATION,
      contentHash: contentHash({ ...RECOMMENDATION, posture: "normal" }),
    });
    await request(decide(tamperedId), ACCEPT);

    const response = await request(
      `/api/decisions/${FIRST_DECISION_ID}/verify`,
    );

    expect(await response.json()).toEqual({
      decisionId: 1,
      intact: false,
      breaks: [{ record: "recommendation", id: 2, reason: "content_altered" }],
    });
  });
});

it("returns 404 for a decision that does not exist", async () => {
  await withApp(async ({ request }) => {
    const response = await request(`/api/decisions/${UNKNOWN_ID}/verify`);

    expect([response.status, await response.json()]).toEqual([
      HTTP_NOT_FOUND,
      { message: "Decision not found" },
    ]);
  });
});
