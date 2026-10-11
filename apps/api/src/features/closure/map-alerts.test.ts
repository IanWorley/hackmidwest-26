import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { Effect } from "effect";
import { expect, it } from "vitest";
import { MAP_PATH } from "./map";
import {
  countingMapClients,
  FAILING_ZONE_URL,
  SHARED_AND_FAILING_ZONES,
  STORM_ALERT,
  STORM_RING,
  SUPERSEDING_AREAS,
  ZONE_A_RING,
  ZONE_A_URL,
  ZONE_ALERT,
  ZONE_B_RING,
  ZONE_B_URL,
} from "./map-test-app";
import { type TestApp, withAppOn } from "./recommendation-test-app";

function withCountingApp(
  run: (
    app: TestApp,
    alertAreaCalls: () => number,
    zoneCalls: () => readonly string[],
  ) => Promise<void>,
  areas?: Parameters<typeof countingMapClients>[0],
): Promise<void> {
  const { clients, alertAreaCalls, zoneCalls } = countingMapClients(areas);
  return withAppOn(createTestDatabaseWithDemoFacilities, clients, (app) =>
    run(app, alertAreaCalls, zoneCalls),
  );
}

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

it(`GET ${MAP_PATH} drops alerts an Update or Cancel supersedes, and the Cancel itself`, async () => {
  await withCountingApp(async ({ get }) => {
    const { alerts } = await (await get(MAP_PATH)).json();

    expect(alerts.features.map(({ id }: { id: string }) => id)).toEqual([
      ZONE_ALERT.id,
      "urn:oid:tornado-update",
    ]);
  }, Effect.succeed(SUPERSEDING_AREAS));
});

it(`GET ${MAP_PATH} fetches each zone once and keeps an alert whose zone NWS cannot serve`, async () => {
  await withCountingApp(async ({ get }, _alertAreaCalls, zoneCalls) => {
    const { alerts } = await (await get(MAP_PATH)).json();

    expect([
      [...zoneCalls()].sort(),
      alerts.features.map(
        ({
          id,
          geometry,
        }: {
          id: string;
          geometry: { type: string } | null;
        }) => [id, geometry?.type ?? null],
      ),
    ]).toEqual([
      [ZONE_A_URL, ZONE_B_URL, FAILING_ZONE_URL].sort(),
      [
        [ZONE_ALERT.id, "MultiPolygon"],
        ["urn:oid:wind", "MultiPolygon"],
        ["urn:oid:flood", null],
      ],
    ]);
  }, Effect.succeed(SHARED_AND_FAILING_ZONES));
});
