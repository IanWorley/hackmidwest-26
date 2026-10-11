import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HTTP_CREATED, HTTP_NOT_FOUND } from "../../runtime";
import { evaluatePosture } from "./engine";
import { recommendationHash } from "./recommendation-store";
import {
  AQI_URL,
  AS_OF,
  CLOCK,
  EVALUATE_PATH,
  EXPECTED_INPUT,
  FORECAST_URL,
  LATEST_PATH,
  OBSERVATION_URL,
  type TestApp,
  UNKNOWN_ID,
  WINTER_STORM,
  withAppOn,
} from "./recommendation-test-app";

const HTTP_UNPROCESSABLE = 422;
const KANSAS_CITY_ID = 1;

function withApp(run: (app: TestApp) => Promise<void>): Promise<void> {
  return withAppOn(createTestDatabaseWithDemoFacilities, run);
}

// Only Date is faked, so the route's one clock read returns CLOCK while Effect's timers stay real.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(CLOCK) });
});

afterEach(() => {
  vi.useRealTimers();
});

it(`POST ${EVALUATE_PATH} stores and returns what the engine recommends for the pulled data as of the requested instant`, async () => {
  await withApp(async ({ post }) => {
    const response = await post(EVALUATE_PATH, { asOf: AS_OF });

    expect(response.status).toBe(HTTP_CREATED);
    const body = await response.json();
    expect({
      id: body.id,
      facilityId: body.facilityId,
      evaluatedAt: body.evaluatedAt,
      asOf: body.asOf,
      mode: body.mode,
      posture: body.posture,
      confidence: body.confidence,
      decideBy: body.decideBy,
      snapshot: body.snapshot,
    }).toEqual({
      id: 1,
      facilityId: KANSAS_CITY_ID,
      evaluatedAt: CLOCK,
      asOf: AS_OF,
      mode: "as_of",
      posture: "full_closure",
      confidence: "high",
      decideBy: "2026-01-14T11:00:00.000Z",
      snapshot: {
        input: EXPECTED_INPUT,
        output: evaluatePosture(EXPECTED_INPUT),
      },
    });
  });
});

it(`POST ${EVALUATE_PATH} evaluates at the clock reading when no asOf is given`, async () => {
  await withApp(async ({ post }) => {
    const response = await post(EVALUATE_PATH);

    const { evaluatedAt, asOf, mode } = await response.json();
    expect({ evaluatedAt, asOf, mode }).toEqual({
      evaluatedAt: CLOCK,
      asOf: CLOCK,
      mode: "live",
    });
  });
});

it(`POST ${EVALUATE_PATH} orders the evaluation, input, hazard, and deadline instants in a timeline`, async () => {
  await withApp(async ({ post }) => {
    const response = await post(EVALUATE_PATH, { asOf: AS_OF });

    const { timeline } = await response.json();
    expect(timeline).toEqual([
      {
        event: "input",
        at: "2026-01-14T06:00:00Z",
        input: {
          kind: "alert",
          source: "nws",
          ref: WINTER_STORM.id,
          asOf: "2026-01-14T06:00:00Z",
        },
      },
      {
        event: "hazardStart",
        at: "2026-01-14T06:00:00.000Z",
        hazard: "winter",
      },
      {
        event: "input",
        at: "2026-01-14T08:00:00Z",
        input: {
          kind: "forecast",
          source: "nws",
          ref: FORECAST_URL,
          asOf: "2026-01-14T08:00:00Z",
        },
      },
      {
        event: "input",
        at: "2026-01-14T08:00:00.000Z",
        input: {
          kind: "airQuality",
          source: "open-meteo",
          ref: AQI_URL,
          asOf: "2026-01-14T08:00:00.000Z",
        },
      },
      {
        event: "input",
        at: "2026-01-14T08:30:00Z",
        input: {
          kind: "observations",
          source: "nws",
          ref: OBSERVATION_URL,
          asOf: "2026-01-14T08:30:00Z",
        },
      },
      { event: "asOf", at: AS_OF },
      { event: "evaluated", at: CLOCK },
      { event: "decideBy", at: "2026-01-14T11:00:00.000Z" },
      {
        event: "hazardEnd",
        at: "2026-01-15T03:00:00.000Z",
        hazard: "winter",
      },
      {
        event: "roadsClear",
        at: "2026-01-15T06:00:00.000Z",
        hazard: "winter",
      },
    ]);
  });
});

it(`POST ${EVALUATE_PATH} hashes every stored column, so the stored hash recomputes from the row`, async () => {
  await withApp(async ({ post }) => {
    const response = await post(EVALUATE_PATH, { asOf: AS_OF });

    const { id, contentHash, mode, timeline, ...content } =
      await response.json();
    expect(contentHash).toBe(recommendationHash(content));
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
    const response = await post(EVALUATE_PATH, {
      asOf: "tomorrow morning",
    });

    expect(response.status).toBe(HTTP_UNPROCESSABLE);
  });
});
