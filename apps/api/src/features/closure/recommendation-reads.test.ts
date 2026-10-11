import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
} from "../../runtime";
import { evaluatePosture } from "./engine";
import {
  AS_OF,
  CLOCK,
  EVALUATE_PATH,
  EXPECTED_INPUT,
  LATER_AS_OF,
  LATEST_PATH,
  type TestApp,
  UNKNOWN_ID,
  withStormAppOn,
} from "./recommendation-test-app";
import { RECOMMENDATIONS_PATH } from "./recommendations";

const FACILITY_WITHOUT_RECOMMENDATIONS_ID = 4;

function withApp(run: (app: TestApp) => Promise<void>): Promise<void> {
  return withStormAppOn(createTestDatabaseWithDemoFacilities, run);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(CLOCK) });
});

afterEach(() => {
  vi.useRealTimers();
});

it(`GET ${LATEST_PATH} returns the facility's newest evaluation`, async () => {
  await withApp(async ({ get, post }) => {
    await post(EVALUATE_PATH, { asOf: AS_OF });
    await post(EVALUATE_PATH, { asOf: LATER_AS_OF });

    const response = await get(LATEST_PATH);

    const { id, asOf } = await response.json();
    expect([response.status, id, asOf]).toEqual([HTTP_OK, 2, LATER_AS_OF]);
  });
});

it(`GET ${LATEST_PATH} returns 404 for a facility that has never been evaluated`, async () => {
  await withApp(async ({ get, post }) => {
    await post(EVALUATE_PATH, { asOf: AS_OF });

    const response = await get(
      `/api/facilities/${FACILITY_WITHOUT_RECOMMENDATIONS_ID}/recommendations/latest`,
    );

    expect([response.status, await response.json()]).toEqual([
      HTTP_NOT_FOUND,
      { message: "Recommendation not found" },
    ]);
  });
});

it(`GET ${RECOMMENDATIONS_PATH}/:id returns the record exactly as the evaluation returned it`, async () => {
  await withApp(async ({ get, post }) => {
    const created = await post(EVALUATE_PATH, { asOf: AS_OF });

    const response = await get(`${RECOMMENDATIONS_PATH}/1`);

    expect([response.status, await response.json()]).toEqual([
      HTTP_OK,
      await created.json(),
    ]);
  });
});

it(`GET ${RECOMMENDATIONS_PATH}/:id returns 404 for an id no recommendation has`, async () => {
  await withApp(async ({ get }) => {
    const response = await get(`${RECOMMENDATIONS_PATH}/${UNKNOWN_ID}`);

    expect([response.status, await response.json()]).toEqual([
      HTTP_NOT_FOUND,
      { message: "Recommendation not found" },
    ]);
  });
});

it(`GET ${RECOMMENDATIONS_PATH}/:id fails with a 500 when the stored snapshot does not parse`, async () => {
  await withApp(async ({ get, insertRow }) => {
    const id = await insertRow({ input: {}, output: {} });

    const response = await get(`${RECOMMENDATIONS_PATH}/${id}`);

    expect(response.status).toBe(HTTP_INTERNAL_SERVER_ERROR);
  });
});

it(`GET ${RECOMMENDATIONS_PATH}/:id/replay re-runs the engine on the stored input and reproduces the stored output`, async () => {
  await withApp(async ({ get, post }) => {
    await post(EVALUATE_PATH, { asOf: AS_OF });

    const response = await get(`${RECOMMENDATIONS_PATH}/1/replay`);

    const expected = evaluatePosture(EXPECTED_INPUT);
    expect([response.status, await response.json()]).toEqual([
      HTTP_OK,
      { id: 1, stored: expected, replayed: expected, matches: true },
    ]);
  });
});

it(`GET ${RECOMMENDATIONS_PATH}/:id/replay reports a mismatch when the stored output is not what the engine returns`, async () => {
  await withApp(async ({ get, insertRow }) => {
    const output = evaluatePosture(EXPECTED_INPUT);
    const id = await insertRow({
      input: EXPECTED_INPUT,
      output: { ...output, rationale: "Edited after the fact." },
    });

    const response = await get(`${RECOMMENDATIONS_PATH}/${id}/replay`);

    const { matches, replayed } = await response.json();
    expect([matches, replayed.rationale]).toEqual([false, output.rationale]);
  });
});
