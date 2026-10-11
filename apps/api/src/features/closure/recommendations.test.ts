import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { expect, it } from "vitest";
import {
  HTTP_CREATED,
  HTTP_NOT_FOUND,
  HTTP_OK,
  HTTP_UNPROCESSABLE_ENTITY,
} from "../../runtime";
import { evaluatePosture } from "./engine";
import { recommendationHash } from "./recommendation-store";
import {
  AFTER_DECIDE_BY,
  AQI_AT,
  AS_OF,
  CLOCK,
  DECIDE_BY,
  EVALUATE_PATH,
  EXPECTED_INPUT,
  FORECAST_UPDATED_AT,
  LATEST_PATH,
  OBSERVED_AT,
  RIVER_AT,
  storedDecisions,
  type TestApp,
  UNKNOWN_ID,
  withStormAppOn,
} from "./recommendation-test-app";
import { AS_OF_HORIZON_HOURS } from "./recommendations";

const KANSAS_CITY_ID = 1;
const DECISION_MAKER_ID = 1;
const BACKUP_ID = 2;
const FIRST_RECOMMENDATION_ID = 1;
const JUST_BEFORE_HORIZON = "2026-01-12T09:29:59.999Z";
const JUST_PAST_HORIZON = "2026-01-16T09:30:00.001Z";
const LAST_INSTANT_OF_YEAR_9999 = "9999-12-31T23:59:59.999Z";
const IMPOSSIBLE_AS_OF = "2026-02-30T00:00:00.000Z";
const ACCEPT = { action: "accept", decidedById: DECISION_MAKER_ID } as const;
const NEXT_MORNING_AS_OF = "2026-01-15T10:30:00.000Z";
const STORM_START = "2026-01-14T06:00:00.000Z";

function withApp(run: (app: TestApp) => Promise<void>): Promise<void> {
  return withStormAppOn(createTestDatabaseWithDemoFacilities, run);
}

it(`POST ${EVALUATE_PATH} stores and returns what the engine recommends for the pulled data as of the requested instant`, async () => {
  await withApp(async ({ post }) => {
    const response = await post(EVALUATE_PATH, { asOf: AS_OF });

    const {
      contentHash: _hash,
      timeline: _timeline,
      ...record
    } = await response.json();
    expect([response.status, record]).toEqual([
      HTTP_CREATED,
      {
        id: FIRST_RECOMMENDATION_ID,
        facilityId: KANSAS_CITY_ID,
        evaluatedAt: CLOCK,
        asOf: AS_OF,
        mode: "as_of",
        posture: "full_closure",
        confidence: "high",
        decideBy: DECIDE_BY,
        snapshot: {
          input: EXPECTED_INPUT,
          output: evaluatePosture(EXPECTED_INPUT),
        },
      },
    ]);
  });
});

it(`POST ${EVALUATE_PATH} evaluates at the clock reading when no asOf is given`, async () => {
  await withApp(async ({ post }) => {
    const response = await post(EVALUATE_PATH);

    const { evaluatedAt, asOf, mode, snapshot } = await response.json();
    expect({ evaluatedAt, asOf, mode, now: snapshot.input.now }).toEqual({
      evaluatedAt: CLOCK,
      asOf: CLOCK,
      mode: "live",
      now: CLOCK,
    });
  });
});

it(`POST ${EVALUATE_PATH} accepts a future asOf, evaluating the data pulled now at that instant and labeling it as_of`, async () => {
  await withApp(async ({ post }) => {
    const response = await post(EVALUATE_PATH, { asOf: NEXT_MORNING_AS_OF });

    const { evaluatedAt, asOf, mode, snapshot } = await response.json();
    expect([
      response.status,
      evaluatedAt,
      asOf,
      mode,
      snapshot.input.now,
    ]).toEqual([
      HTTP_CREATED,
      CLOCK,
      NEXT_MORNING_AS_OF,
      "as_of",
      NEXT_MORNING_AS_OF,
    ]);
  });
});

it(`POST ${EVALUATE_PATH} orders the input, hazard, evaluation, and deadline instants in a timeline`, async () => {
  await withApp(async ({ post }) => {
    const response = await post(EVALUATE_PATH, { asOf: AS_OF });

    const { timeline } = await response.json();
    expect(timeline).toEqual([
      { event: "hazardStart", at: STORM_START, hazard: "winter" },
      { event: "input", at: AQI_AT, input: "airQuality" },
      { event: "input", at: FORECAST_UPDATED_AT, input: "forecast" },
      { event: "input", at: OBSERVED_AT, input: "observations" },
      { event: "input", at: RIVER_AT, input: "gauge" },
      { event: "asOf", at: AS_OF },
      { event: "evaluated", at: CLOCK },
      { event: "input", at: CLOCK, input: "alerts" },
      { event: "decideBy", at: DECIDE_BY },
      { event: "hazardEnd", at: "2026-01-15T03:00:00.000Z", hazard: "winter" },
      { event: "roadsClear", at: "2026-01-15T06:00:00.000Z", hazard: "winter" },
    ]);
  });
});

it(`POST ${EVALUATE_PATH} stores a hash that recomputes from the returned row`, async () => {
  await withApp(async ({ post }) => {
    const response = await post(EVALUATE_PATH, { asOf: AS_OF });

    const record = await response.json();
    expect(record.contentHash).toBe(recommendationHash(record));
  });
});

it(`POST ${EVALUATE_PATH} returns 404 and stores nothing for an unknown facility`, async () => {
  await withApp(async ({ get, post }) => {
    const response = await post(
      `/api/facilities/${UNKNOWN_ID}/recommendations`,
    );
    const latest = await get(LATEST_PATH);

    expect([response.status, await response.json(), latest.status]).toEqual([
      HTTP_NOT_FOUND,
      { message: "Facility not found" },
      HTTP_NOT_FOUND,
    ]);
  });
});

it(`POST ${EVALUATE_PATH} rejects an asOf that is not a timestamp`, async () => {
  await withApp(async ({ post }) => {
    const response = await post(EVALUATE_PATH, { asOf: "tomorrow morning" });

    expect(response.status).toBe(HTTP_UNPROCESSABLE_ENTITY);
  });
});

it(`POST ${EVALUATE_PATH} rejects an unknown body field and stores nothing`, async () => {
  await withApp(async ({ get, post }) => {
    const response = await post(EVALUATE_PATH, {
      asOf: AS_OF,
      posture: "normal",
    });
    const { type, property, message } = await response.json();
    const latest = await get(LATEST_PATH);

    expect([
      response.status,
      { type, property, message },
      latest.status,
    ]).toEqual([
      HTTP_UNPROCESSABLE_ENTITY,
      {
        type: "validation",
        property: "/posture",
        message: "Unexpected property",
      },
      HTTP_NOT_FOUND,
    ]);
  });
});

it(`POST ${EVALUATE_PATH} after decideBy records that nobody decided the previous recommendation, naming the backup`, async () => {
  await withApp(async ({ db, post, setClock }) => {
    await post(EVALUATE_PATH);
    setClock(AFTER_DECIDE_BY);

    await post(EVALUATE_PATH);

    const missed = (await storedDecisions(db)).map(
      ({ recommendationId, action, decidedById, decidedAt }) => ({
        recommendationId,
        action,
        decidedById,
        decidedAt,
      }),
    );
    expect(missed).toEqual([
      {
        recommendationId: FIRST_RECOMMENDATION_ID,
        action: "no_decision",
        decidedById: BACKUP_ID,
        decidedAt: AFTER_DECIDE_BY,
      },
    ]);
  });
});

it(`POST ${EVALUATE_PATH} rejects an asOf more than ${AS_OF_HORIZON_HOURS} hours from the clock and stores nothing`, async () => {
  await withApp(async ({ get, post }) => {
    const responses = await Promise.all(
      [JUST_BEFORE_HORIZON, JUST_PAST_HORIZON, LAST_INSTANT_OF_YEAR_9999].map(
        (asOf) => post(EVALUATE_PATH, { asOf }),
      ),
    );
    const bodies = await Promise.all(
      responses.map(async (response) => [
        response.status,
        await response.json(),
      ]),
    );
    const latest = await get(LATEST_PATH);

    expect([bodies, latest.status]).toEqual([
      Array.from({ length: 3 }, () => [
        HTTP_UNPROCESSABLE_ENTITY,
        {
          type: "validation",
          on: "body",
          property: "/asOf",
          message: `Expected asOf within ${AS_OF_HORIZON_HOURS} hours of the clock reading`,
        },
      ]),
      HTTP_NOT_FOUND,
    ]);
  });
});

it(`POST ${EVALUATE_PATH} rejects an impossible date instead of rolling it over`, async () => {
  await withApp(async ({ post }) => {
    const response = await post(EVALUATE_PATH, { asOf: IMPOSSIBLE_AS_OF });

    const { property, message } = await response.json();
    expect([response.status, property, message]).toEqual([
      HTTP_UNPROCESSABLE_ENTITY,
      "/asOf",
      "Expected string to match 'utc-instant' format",
    ]);
  });
});

it("an evaluated recommendation can be accepted, and the decision chain verifies intact", async () => {
  await withApp(async ({ get, post }) => {
    const evaluated = await post(EVALUATE_PATH);
    const { id } = await evaluated.json();
    const decided = await post(`/api/recommendations/${id}/decisions`, ACCEPT);
    const decision = await decided.json();

    const verified = await get(`/api/decisions/${decision.id}/verify`);

    expect([decided.status, verified.status, await verified.json()]).toEqual([
      HTTP_CREATED,
      HTTP_OK,
      { decisionId: decision.id, intact: true, breaks: [] },
    ]);
  });
});
