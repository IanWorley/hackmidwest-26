import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { Effect } from "effect";
import { expect, it } from "vitest";
import { HTTP_OK } from "../../runtime";
import { MAP_PATH } from "./map";
import {
  ALERTS_DOWN,
  countingMapClients,
  STORM_ALERT,
  STORM_RING,
  SUPERSEDING_AREAS,
  ZONE_A_RING,
  ZONE_ALERT,
  ZONE_B_RING,
} from "./map-test-app";
import {
  CLOCK,
  EVALUATE_PATH,
  LATER_AS_OF,
  type TestApp,
  withAppOn,
  withStormAppOn,
} from "./recommendation-test-app";

const DEMO_FACILITY_COUNT = 4;
/** Earlier than the test app's clock, for an evaluation that read the clock first but stored second. */
const EARLIER_CLOCK = "2026-01-14T09:00:00.000Z";
const KANSAS_CITY_ID = 1;
const KANSAS_CITY_DECIDER = 1;
const DECISIONS_PATH = "/api/recommendations/1/decisions";
/** 61 seconds after the test app's clock, just past the 60-second live-conditions TTL. */
const PAST_TTL = "2026-01-14T09:31:01.000Z";
const CLEAN_AIR = { value: 40, observedAt: "2026-01-14T08:00:00.000Z" };
const NOT_EVALUATED = { posture: "not_evaluated" };

function withCountingApp(
  run: (app: TestApp, alertAreaCalls: () => number) => Promise<void>,
  areas?: Parameters<typeof countingMapClients>[0],
): Promise<void> {
  const { clients, alertAreaCalls } = countingMapClients(areas);
  return withAppOn(createTestDatabaseWithDemoFacilities, clients, (app) =>
    run(app, alertAreaCalls),
  );
}

it(`GET ${MAP_PATH} reports each facility's newest live recommendation, not a later preview, or not_evaluated without one`, async () => {
  await withStormAppOn(
    createTestDatabaseWithDemoFacilities,
    async ({ get, post }) => {
      await post(EVALUATE_PATH);
      await post(EVALUATE_PATH, { asOf: LATER_AS_OF });

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
            recommendationId: 1,
            decideBy: "2026-01-14T11:00:00.000Z",
            asOf: CLOCK,
            decision: null,
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

it(`GET ${MAP_PATH} reports the newest decision on a facility's recommendation`, async () => {
  await withStormAppOn(
    createTestDatabaseWithDemoFacilities,
    async ({ get, post }) => {
      await post(EVALUATE_PATH);
      await post(DECISIONS_PATH, {
        action: "accept",
        decidedById: KANSAS_CITY_DECIDER,
      });
      await post(DECISIONS_PATH, {
        action: "override",
        chosenPosture: "normal",
        decidedById: KANSAS_CITY_DECIDER,
        supersedesDecisionId: 1,
        reason: {
          category: "road_reports",
          text: "County reports the roads clear.",
        },
      });

      const { facilities } = await (await get(MAP_PATH)).json();

      expect(
        facilities.find(({ id }: { id: number }) => id === KANSAS_CITY_ID)
          .standing.decision,
      ).toEqual({
        action: "override",
        chosenPosture: "normal",
        decidedAt: CLOCK,
      });
    },
  );
});

it(`GET ${MAP_PATH} drops alerts an Update or Cancel supersedes, and the Cancel itself`, async () => {
  await withCountingApp(async ({ get }) => {
    const { alerts } = await (await get(MAP_PATH)).json();

    expect(alerts.features.map(({ id }: { id: string }) => id)).toEqual([
      ZONE_ALERT.id,
      "urn:oid:tornado-update",
    ]);
  }, Effect.succeed(SUPERSEDING_AREAS));
});

it(`GET ${MAP_PATH} still reports standings when the live pull fails`, async () => {
  await withCountingApp(async ({ get }) => {
    const response = await get(MAP_PATH);
    const { facilities, alerts } = await response.json();

    expect([
      response.status,
      alerts,
      facilities.map(
        ({
          name,
          aqi,
          standing,
        }: {
          name: string;
          aqi: unknown;
          standing: unknown;
        }) => [name, aqi, standing],
      ),
    ]).toEqual([
      HTTP_OK,
      null,
      [
        ["Fargo Service Center", null, NOT_EVALUATED],
        ["Kansas City Area Service Center", null, NOT_EVALUATED],
        ["Lafayette Service Center", null, NOT_EVALUATED],
        ["Yakima Service Center", null, NOT_EVALUATED],
      ],
    ]);
  }, Effect.fail(ALERTS_DOWN));
});

it(`GET ${MAP_PATH} follows the newest evaluation time, not the newest row, when evaluations store out of order`, async () => {
  await withStormAppOn(
    createTestDatabaseWithDemoFacilities,
    async ({ get, post, setClock }) => {
      await post(EVALUATE_PATH);
      setClock(EARLIER_CLOCK);
      await post(EVALUATE_PATH);

      const { facilities } = await (await get(MAP_PATH)).json();

      const kansasCity = facilities.find(
        ({ id }: { id: number }) => id === KANSAS_CITY_ID,
      );
      expect([
        kansasCity.standing.recommendationId,
        kansasCity.standing.asOf,
      ]).toEqual([1, CLOCK]);
    },
  );
});
