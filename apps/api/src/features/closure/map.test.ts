import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { expect, it } from "vitest";
import { MAP_PATH } from "./map";
import {
  countingMapClients,
  STORM_ALERT,
  STORM_RING,
  ZONE_A_RING,
  ZONE_ALERT,
  ZONE_B_RING,
} from "./map-test-app";
import {
  AS_OF,
  type TestApp,
  withAppOn,
  withStormAppOn,
} from "./recommendation-test-app";

const DEMO_FACILITY_COUNT = 4;
/** 61 seconds after the test app's clock, just past the 60-second live-conditions TTL. */
const PAST_TTL = "2026-01-14T09:31:01.000Z";
const CLEAN_AIR = { value: 40, observedAt: "2026-01-14T08:00:00.000Z" };
const NOT_EVALUATED = { posture: "not_evaluated" };

function withCountingApp(
  run: (app: TestApp, alertAreaCalls: () => number) => Promise<void>,
): Promise<void> {
  const { clients, alertAreaCalls } = countingMapClients();
  return withAppOn(createTestDatabaseWithDemoFacilities, clients, (app) =>
    run(app, alertAreaCalls),
  );
}

it(`GET ${MAP_PATH} reports each facility's latest recommendation, or not_evaluated without one`, async () => {
  await withStormAppOn(
    createTestDatabaseWithDemoFacilities,
    async ({ get, insertUncheckedRow }) => {
      const recommendationId = await insertUncheckedRow({});

      const { facilities } = await (await get(MAP_PATH)).json();

      expect(facilities).toEqual([
        {
          id: 2,
          name: "Fargo Service Center",
          lat: 46.8772,
          lon: -96.7898,
          aqi: CLEAN_AIR,
          standing: NOT_EVALUATED,
        },
        {
          id: 1,
          name: "Kansas City Area Service Center",
          lat: 39.0997,
          lon: -94.5786,
          aqi: CLEAN_AIR,
          standing: {
            posture: "full_closure",
            recommendationId,
            decideBy: "2026-01-14T11:00:00.000Z",
            asOf: AS_OF,
            mode: "as_of",
            decided: false,
          },
        },
        {
          id: 4,
          name: "Lafayette Service Center",
          lat: 30.2241,
          lon: -92.0198,
          aqi: CLEAN_AIR,
          standing: NOT_EVALUATED,
        },
        {
          id: 3,
          name: "Yakima Service Center",
          lat: 46.6021,
          lon: -120.5059,
          aqi: CLEAN_AIR,
          standing: NOT_EVALUATED,
        },
      ]);
    },
  );
});

it(`GET ${MAP_PATH} attaches zone geometry to zone-based alerts, keeps storm polygons, and lists each alert once`, async () => {
  await withCountingApp(async ({ get }) => {
    const { alerts } = await (await get(MAP_PATH)).json();

    expect(alerts).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: ZONE_ALERT.id,
          geometry: {
            type: "MultiPolygon",
            coordinates: [[ZONE_A_RING], [ZONE_B_RING]],
          },
          properties: {
            event: "Winter Storm Warning",
            headline: null,
            severity: "Severe",
            certainty: "Likely",
            urgency: "Expected",
            onset: "2026-01-14T06:00:00Z",
            ends: "2026-01-15T03:00:00Z",
          },
        },
        {
          type: "Feature",
          id: STORM_ALERT.id,
          geometry: { type: "Polygon", coordinates: [STORM_RING] },
          properties: {
            event: "Tornado Warning",
            headline: null,
            severity: "Extreme",
            certainty: "Likely",
            urgency: "Expected",
            onset: "2026-01-14T06:00:00Z",
            ends: "2026-01-14T11:00:00Z",
          },
        },
      ],
    });
  });
});

it(`GET ${MAP_PATH} reuses live conditions within the TTL and pulls them again after it`, async () => {
  await withCountingApp(async ({ get, setClock }, alertAreaCalls) => {
    await get(MAP_PATH);
    const afterFirst = alertAreaCalls();
    await get(MAP_PATH);
    const afterSecond = alertAreaCalls();
    setClock(PAST_TTL);
    await get(MAP_PATH);

    expect([afterFirst, afterSecond, alertAreaCalls()]).toEqual([
      DEMO_FACILITY_COUNT,
      DEMO_FACILITY_COUNT,
      DEMO_FACILITY_COUNT + DEMO_FACILITY_COUNT,
    ]);
  });
});
