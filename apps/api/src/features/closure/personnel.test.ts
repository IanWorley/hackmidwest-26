import { employeeStatusEvents, recommendations } from "@hackmidwest/db";
import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { expect, it } from "vitest";
import { HTTP_CREATED, HTTP_NOT_FOUND, HTTP_OK } from "../../runtime";
import {
  appRunner,
  BACKUP_ID,
  type Db,
  DECIDED_AT,
  DECIDER_ID,
  FACILITY_ID,
  RECOMMENDATION,
  UNKNOWN_ID,
} from "./decision-test-fixtures";
import { evaluatePosture } from "./engine";
import type { EngineInput } from "./engine-input";
import {
  AFTERNOON_HOUR,
  ALL_DAY_END,
  alerts,
  forecast,
  input,
  nwsAlert,
} from "./engine-test-fixtures";
import type { PersonnelResponse } from "./personnel-schema";
import { parseSnapshot, type Snapshot } from "./recommendation-store";
import { contentHash, type JsonValue } from "./records";

const withApp = appRunner(createTestDatabaseWithDemoFacilities);

const AVERY_TELEWORK_ELIGIBLE = 1;
const BIANCA_ESSENTIAL = 2;
const DELIA_ALREADY_TELEWORKING = 4;
const HANA_ACCESSIBILITY_NEEDS = 8;
const LATER = "2026-10-02T14:00:00.000Z";
/** 03:00 in Kansas City on the engine fixtures' facility day, 2026-01-14. */
const ON_FIXTURE_DAY = "2026-01-14T09:00:00.000Z";
/** After Kansas City closes on 2026-01-14, when decisions are about 2026-01-15. */
const AFTER_FIXTURE_DAY_CLOSE = "2026-01-14T23:00:00.000Z";
const WIND_RELEASE_AT = "2026-01-14T17:45:00.000Z";
const EARLIER_RELEASE_AT = "2026-01-14T16:30:00.000Z";
const SUSTAINED_WIND_DISMISSAL = input(["wind"], {
  forecast: forecast([...AFTERNOON_HOUR, "40 mph"]),
});
const ALL_DAY_CLOSURE = input(["winter"], {
  alerts: alerts(nwsAlert("Winter Storm Warning", "Severe", ALL_DAY_END)),
});
const REASON = {
  category: "road_reports",
  text: "County reports the highway closed.",
} as const;

const PERSONNEL_PATH = `/api/facilities/${FACILITY_ID}/personnel`;

function jsonOf(snapshot: Snapshot): JsonValue {
  return JSON.parse(JSON.stringify(snapshot));
}

/** Stores the engine's recommendation for `engineInput` at facility 1, and returns its id. */
async function stageRecommendation(
  db: Db,
  engineInput: EngineInput,
): Promise<number> {
  const output = evaluatePosture(engineInput);
  const content = {
    ...RECOMMENDATION,
    posture: output.status.posture,
    snapshot: jsonOf(parseSnapshot({ input: engineInput, output })),
  };
  const [row] = await db
    .insert(recommendations)
    .values({ ...content, contentHash: contentHash(content) })
    .returning({ id: recommendations.id });
  if (row === undefined) {
    throw new Error("The recommendation insert returned no row");
  }
  return row.id;
}

async function personnel(
  request: (path: string, body?: object) => Promise<Response>,
): Promise<PersonnelResponse> {
  const response = await request(PERSONNEL_PATH);
  if (response.status !== HTTP_OK) {
    throw new Error(`GET ${PERSONNEL_PATH} answered ${response.status}`);
  }
  return response.json();
}

function person(
  body: PersonnelResponse,
  id: number,
): PersonnelResponse["people"][number] | undefined {
  return body.people.find(({ employeeId }) => employeeId === id);
}

it("answers 404 for an unknown facility", async () => {
  await withApp(async ({ request }) => {
    const response = await request(`/api/facilities/${UNKNOWN_ID}/personnel`);

    expect(response.status).toBe(HTTP_NOT_FOUND);
    expect(await response.json()).toEqual({ message: "Facility not found" });
  });
});

it("with no decision, lists each person at their baseline with who may record a status", async () => {
  await withApp(async ({ request }) => {
    const body = await personnel(request);

    expect(body).toMatchObject({
      facilityId: FACILITY_ID,
      asOf: DECIDED_AT,
      decision: null,
      posture: { kind: "none" },
      recorders: [
        { id: DECIDER_ID, name: "Dana Whitfield" },
        { id: BACKUP_ID, name: "Marcus Oyelaran" },
      ],
    });
    expect(person(body, DELIA_ALREADY_TELEWORKING)).toMatchObject({
      baseline: { status: "teleworking" },
      effective: { kind: "teleworking", cause: { source: "baseline" } },
    });
    expect(person(body, HANA_ACCESSIBILITY_NEEDS)).toMatchObject({
      name: "Hana Kowalczyk",
      hasAccessibilityNeeds: true,
      effective: { kind: "working_onsite" },
    });
    expect(person(body, HANA_ACCESSIBILITY_NEEDS)).not.toHaveProperty(
      "accessibilityNeeds",
    );
  });
});

it("takes the latest event in effect as baseline and shows a future-dated one only as the latest event", async () => {
  await withApp(async ({ request }) => {
    await request(`/api/employees/${AVERY_TELEWORK_ELIGIBLE}/status`, {
      status: "teleworking",
      reportedById: DECIDER_ID,
    });
    const scheduled = await request(
      `/api/employees/${AVERY_TELEWORK_ELIGIBLE}/status`,
      {
        status: "not_working",
        note: "Leave starts this afternoon.",
        reportedById: DECIDER_ID,
        effectiveFrom: LATER,
      },
    );
    expect(scheduled.status).toBe(HTTP_CREATED);

    const avery = person(await personnel(request), AVERY_TELEWORK_ELIGIBLE);

    expect(avery).toMatchObject({
      baseline: { status: "teleworking" },
      latestEvent: { status: "not_working", effectiveFrom: LATER },
      effective: { kind: "teleworking" },
    });
  });
});

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

it("leaves an event reported after asOf out of latestEvent", async () => {
  await withApp(async ({ db, request }) => {
    await db.insert(employeeStatusEvents).values({
      employeeId: AVERY_TELEWORK_ELIGIBLE,
      status: "teleworking",
      reportedById: DECIDER_ID,
      reportedAt: LATER,
      effectiveFrom: LATER,
    });

    const avery = person(await personnel(request), AVERY_TELEWORK_ELIGIBLE);

    expect(avery).toMatchObject({
      baseline: { status: "working_onsite" },
      latestEvent: { reportedAt: "2026-10-01T12:00:00.000Z" },
    });
  });
});
