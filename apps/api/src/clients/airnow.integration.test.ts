import process from "node:process";
import { Value } from "@sinclair/typebox/value";
import { Effect } from "effect";
import { t } from "elysia";
import { expect, it } from "vitest";
import {
  airQualityReadings,
  ReadingSchema,
} from "../features/closure/readings";
import { makeAirNowClient } from "./airnow";

const apiKey = process.env.AIRNOW_API_KEY ?? "";
const KANSAS_CITY = { lat: 39.0997, lon: -94.5786 };

it("pulls live AirNow observations for Kansas City and normalizes them", {
  skip: apiKey === "",
}, async () => {
  const airNow = makeAirNowClient({ apiKey, fetch: globalThis.fetch });

  const observations = await Effect.runPromise(
    airNow.currentObservations(KANSAS_CITY),
  );

  expect({
    hasObservations: observations.length > 0,
    readingsMatchSchema: Value.Check(
      t.Array(ReadingSchema),
      airQualityReadings(observations),
    ),
  }).toEqual({ hasObservations: true, readingsMatchSchema: true });
});
