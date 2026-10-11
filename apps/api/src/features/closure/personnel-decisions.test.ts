import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { expect, it } from "vitest";
import { HTTP_CREATED } from "../../runtime";
import { appRunner, DECIDER_ID } from "./decision-test-fixtures";
import {
  AFTER_FIXTURE_DAY_CLOSE,
  ALL_DAY_CLOSURE,
  AVERY_TELEWORK_ELIGIBLE,
  BIANCA_ESSENTIAL,
  DELIA_ALREADY_TELEWORKING,
  EARLIER_RELEASE_AT,
  ON_FIXTURE_DAY,
  person,
  personnel,
  REASON,
  SUSTAINED_WIND_DISMISSAL,
  stageRecommendation,
  WIND_RELEASE_AT,
} from "./personnel-test-fixtures";

const withApp = appRunner(createTestDatabaseWithDemoFacilities);

it("resolves an accepted early dismissal per person", async () => {
  await withApp(async ({ db, request }) => {
    await request(`/api/employees/${DELIA_ALREADY_TELEWORKING}/status`, {
      status: "teleworking",
      reportedById: DECIDER_ID,
    });
    const recommendationId = await stageRecommendation(
      db,
      SUSTAINED_WIND_DISMISSAL,
    );
    const decided = await request(
      `/api/recommendations/${recommendationId}/decisions`,
      { action: "accept", decidedById: DECIDER_ID },
    );
    expect(decided.status).toBe(HTTP_CREATED);
    const { id: decisionId } = await decided.json();

    const body = await personnel(request);

    expect(body).toMatchObject({
      decision: { id: decisionId, recommendationId, action: "accept" },
      posture: {
        kind: "decided",
        posture: { posture: "early_dismissal", releaseAt: WIND_RELEASE_AT },
      },
    });
    expect(person(body, AVERY_TELEWORK_ELIGIBLE)).toMatchObject({
      effective: {
        kind: "dismissed",
        release: { at: WIND_RELEASE_AT },
        cause: { source: "posture", posture: "early_dismissal" },
      },
    });
    expect(person(body, BIANCA_ESSENTIAL)).toMatchObject({
      effective: { kind: "report_required" },
    });
    expect(person(body, DELIA_ALREADY_TELEWORKING)).toMatchObject({
      effective: { kind: "teleworking", cause: { source: "baseline" } },
    });
  }, ON_FIXTURE_DAY);
});

it("applies a directive on the current decision over the facility posture", async () => {
  await withApp(async ({ db, request }) => {
    const recommendationId = await stageRecommendation(
      db,
      SUSTAINED_WIND_DISMISSAL,
    );
    const decided = await request(
      `/api/recommendations/${recommendationId}/decisions`,
      { action: "accept", decidedById: DECIDER_ID },
    );
    const { id: decisionId } = await decided.json();
    const issued = await request(`/api/decisions/${decisionId}/directives`, {
      scope: { kind: "employee", employeeId: AVERY_TELEWORK_ELIGIBLE },
      directive: "dismissed",
      effectiveAt: EARLIER_RELEASE_AT,
      reason: REASON,
      issuedById: DECIDER_ID,
    });
    expect(issued.status).toBe(HTTP_CREATED);

    const body = await personnel(request);

    expect(person(body, AVERY_TELEWORK_ELIGIBLE)).toMatchObject({
      effective: {
        kind: "dismissed",
        release: { at: EARLIER_RELEASE_AT },
        cause: {
          source: "directive",
          directive: { directive: "dismissed", reasonText: REASON.text },
        },
      },
    });
    expect(person(body, BIANCA_ESSENTIAL)).toMatchObject({
      effective: { kind: "report_required", cause: { source: "posture" } },
    });
  }, ON_FIXTURE_DAY);
});

it("leaves people at their baseline while the current decision is a deferral", async () => {
  await withApp(async ({ db, request }) => {
    const recommendationId = await stageRecommendation(
      db,
      SUSTAINED_WIND_DISMISSAL,
    );
    await request(`/api/recommendations/${recommendationId}/decisions`, {
      action: "defer",
      recheckAt: "2026-10-02T10:45:00.000Z",
      decidedById: DECIDER_ID,
      reason: REASON,
    });

    const body = await personnel(request);

    expect(body.posture).toEqual({ kind: "undecided", action: "defer" });
    expect(person(body, AVERY_TELEWORK_ELIGIBLE)).toMatchObject({
      effective: { kind: "working_onsite", cause: { source: "baseline" } },
    });
  }, ON_FIXTURE_DAY);
});

it("returns people without an effective status when the override has no time to resolve against", async () => {
  await withApp(async ({ db, request }) => {
    const recommendationId = await stageRecommendation(db, ALL_DAY_CLOSURE);
    await request(`/api/recommendations/${recommendationId}/decisions`, {
      action: "override",
      chosenPosture: "early_dismissal",
      decidedById: DECIDER_ID,
      reason: REASON,
    });

    const body = await personnel(request);

    expect(body.posture).toEqual({
      kind: "untimed",
      posture: "early_dismissal",
    });
    expect(person(body, AVERY_TELEWORK_ELIGIBLE)).toMatchObject({
      baseline: { status: "working_onsite" },
    });
    expect(person(body, AVERY_TELEWORK_ELIGIBLE)).not.toHaveProperty(
      "effective",
    );
  }, ON_FIXTURE_DAY);
});

it("leaves today undecided when the newest decision is about another facility day", async () => {
  await withApp(async ({ db, request }) => {
    const recommendationId = await stageRecommendation(
      db,
      SUSTAINED_WIND_DISMISSAL,
    );
    const decided = await request(
      `/api/recommendations/${recommendationId}/decisions`,
      { action: "accept", decidedById: DECIDER_ID },
    );
    expect(decided.status).toBe(HTTP_CREATED);

    const body = await personnel(request);

    expect(body).toMatchObject({ decision: null, posture: { kind: "none" } });
    expect(person(body, AVERY_TELEWORK_ELIGIBLE)).toMatchObject({
      effective: { kind: "working_onsite", cause: { source: "baseline" } },
    });
  }, AFTER_FIXTURE_DAY_CLOSE);
});
