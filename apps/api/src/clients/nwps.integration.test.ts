import process from "node:process";
import { Effect } from "effect";
import { expect, it } from "vitest";
import { makeNwpsClient } from "./nwps";
import { KCDM7 } from "./nwps-test-client";

// NWPS needs no key, so CI opts out by leaving this unset.
const enabled = process.env.LIVE_FLOOD_TEST === "1";
// Covers the client's worst case: four 10 s attempts plus backoff.
const LIVE_PULL_TIMEOUT_MS = 60_000;

it("pulls the live NWPS gauge for the Missouri River at Kansas City", {
  skip: !enabled,
  timeout: LIVE_PULL_TIMEOUT_MS,
}, async () => {
  const gauge = await Effect.runPromise(makeNwpsClient().gauge(KCDM7));

  expect({ lid: gauge.lid, floodStagesFt: gauge.floodStagesFt }).toEqual({
    lid: "KCDM7",
    floodStagesFt: { action: 29, minor: 32, moderate: 35, major: 49 },
  });
});
