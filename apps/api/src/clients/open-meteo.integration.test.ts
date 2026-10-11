import process from "node:process";
import { Value } from "@sinclair/typebox/value";
import { Effect } from "effect";
import { t } from "elysia";
import { expect, it } from "vitest";
import {
  airQualityReadings,
  ReadingSchema,
} from "../features/closure/readings";
import { makeOpenMeteoClient } from "./open-meteo";

// Open-Meteo needs no key, so CI opts out by leaving this unset.
const enabled = process.env.LIVE_AIR_QUALITY_TEST === "1";
const KANSAS_CITY = { lat: 39.0997, lon: -94.5786 };
// Covers the client's worst case: four 10 s attempts plus backoff.
const LIVE_PULL_TIMEOUT_MS = 60_000;

it("pulls the live Open-Meteo AQI for Kansas City and normalizes it", {
  skip: !enabled,
  timeout: LIVE_PULL_TIMEOUT_MS,
}, async () => {
  const observation = await Effect.runPromise(
    makeOpenMeteoClient().currentAqi(KANSAS_CITY),
  );
  const readings = airQualityReadings(observation);

  expect({
    readingCount: readings.length,
    readingsMatchSchema: Value.Check(t.Array(ReadingSchema), readings),
  }).toEqual({ readingCount: 1, readingsMatchSchema: true });
});
