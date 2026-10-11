import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { expect, it } from "vitest";
import {
  HTTP_CREATED,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
  HTTP_UNPROCESSABLE_ENTITY,
} from "../../runtime";
import { evaluatePosture } from "./engine";
import { parseSnapshot } from "./recommendation-store";
import {
  AS_OF,
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
const HEX_ID = "0x1";
const NEWEST_LIVE_ID = 2;
const { output: STORED_OUTPUT } = parseSnapshot({
  input: EXPECTED_INPUT,
  output: evaluatePosture(EXPECTED_INPUT),
});

function withApp(run: (app: TestApp) => Promise<void>): Promise<void> {
  return withStormAppOn(createTestDatabaseWithDemoFacilities, run);
}

it(`GET ${LATEST_PATH} returns the facility's newest live evaluation, skipping later previews`, async () => {
  await withApp(async ({ get, post }) => {
    await post(EVALUATE_PATH);
    await post(EVALUATE_PATH);
    await post(EVALUATE_PATH, { asOf: LATER_AS_OF });

    const response = await get(LATEST_PATH);

    const { id, mode } = await response.json();
    expect([response.status, id, mode]).toEqual([
      HTTP_OK,
      NEWEST_LIVE_ID,
      "live",
    ]);
  });
});

it(`GET ${LATEST_PATH} returns 404 for a facility evaluated only as previews`, async () => {
  await withApp(async ({ get, post }) => {
    await post(EVALUATE_PATH, { asOf: AS_OF });

    const response = await get(LATEST_PATH);

    expect(response.status).toBe(HTTP_NOT_FOUND);
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
  await withApp(async ({ get, insertUncheckedRow }) => {
    const id = await insertUncheckedRow({ input: {}, output: {} });

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
  await withApp(async ({ get, insertUncheckedRow }) => {
    const id = await insertUncheckedRow({
      input: EXPECTED_INPUT,
      output: { ...STORED_OUTPUT, rationale: "Edited after the fact." },
    });

    const response = await get(`${RECOMMENDATIONS_PATH}/${id}/replay`);

    const { matches, replayed } = await response.json();
    expect([matches, replayed.rationale]).toEqual([
      false,
      STORED_OUTPUT.rationale,
    ]);
  });
});

it(`GET ${RECOMMENDATIONS_PATH}/:id/replay returns 404 for an id no recommendation has`, async () => {
  await withApp(async ({ get }) => {
    const response = await get(`${RECOMMENDATIONS_PATH}/${UNKNOWN_ID}/replay`);

    expect([response.status, await response.json()]).toEqual([
      HTTP_NOT_FOUND,
      { message: "Recommendation not found" },
    ]);
  });
});

it("every recommendation route rejects a non-decimal id with 422 instead of aliasing id 1", async () => {
  await withApp(async ({ get, post }) => {
    const created = await post(EVALUATE_PATH, { asOf: AS_OF });

    const responses = await Promise.all([
      post(`/api/facilities/${HEX_ID}/recommendations`),
      get(`/api/facilities/${HEX_ID}/recommendations/latest`),
      get(`${RECOMMENDATIONS_PATH}/${HEX_ID}`),
      get(`${RECOMMENDATIONS_PATH}/${HEX_ID}/replay`),
    ]);

    expect([created.status, ...responses.map(({ status }) => status)]).toEqual([
      HTTP_CREATED,
      HTTP_UNPROCESSABLE_ENTITY,
      HTTP_UNPROCESSABLE_ENTITY,
      HTTP_UNPROCESSABLE_ENTITY,
      HTTP_UNPROCESSABLE_ENTITY,
    ]);
  });
});

it(`GET ${RECOMMENDATIONS_PATH}/:id fails with a 500 when the stored snapshot carries a field the schema does not list`, async () => {
  await withApp(async ({ get, insertUncheckedRow }) => {
    const id = await insertUncheckedRow({
      input: EXPECTED_INPUT,
      output: { ...STORED_OUTPUT, unlisted: "hashed but never returned" },
    });

    const response = await get(`${RECOMMENDATIONS_PATH}/${id}`);

    expect(response.status).toBe(HTTP_INTERNAL_SERVER_ERROR);
  });
});
