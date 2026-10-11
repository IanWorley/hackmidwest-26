import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { hazardWindow } from "./nws-model";
import {
  alertsResponse,
  clientFor,
  KANSAS_CITY,
  pointsResponse,
  squareRing,
} from "./nws-test-client";

const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVICE_UNAVAILABLE = 503;

const ALERT = {
  id: "urn:oid:alert-2",
  event: "Winter Storm Warning",
  headline: "Winter Storm Warning until Saturday",
  severity: "Severe",
  certainty: "Likely",
  urgency: "Expected",
  messageType: "Update",
  references: [{ identifier: "urn:oid:alert-1", sender: "w-nws" }],
  effective: "2026-01-09T09:00:00-06:00",
  onset: "2026-01-09T18:00:00-06:00",
  ends: "2026-01-10T12:00:00-06:00",
  expires: "2026-01-10T06:00:00-06:00",
};

describe("hazardWindow", () => {
  it("runs from onset to ends when NWS gives both", () => {
    expect(hazardWindow(ALERT)).toEqual({
      start: "2026-01-09T18:00:00-06:00",
      end: "2026-01-10T12:00:00-06:00",
      endBasis: "ends",
    });
  });

  it("falls back to expires, marked as such, when ends is null", () => {
    expect(hazardWindow({ ...ALERT, ends: null })).toEqual({
      start: "2026-01-09T18:00:00-06:00",
      end: "2026-01-10T06:00:00-06:00",
      endBasis: "expires",
    });
  });

  it("starts at effective when onset is null", () => {
    expect(hazardWindow({ ...ALERT, onset: null }).start).toBe(
      "2026-01-09T09:00:00-06:00",
    );
  });
});

it("sends rounded coordinates with the User-Agent and GeoJSON Accept headers", async () => {
  const { client, sent } = clientFor([Response.json({ features: [] })]);

  await Effect.runPromise(client.activeAlerts(KANSAS_CITY));

  expect(sent).toEqual([
    {
      url: "http://nws.test/alerts/active?point=39.0997,-94.5786",
      userAgent: "hackmidwest-26 test (ops@example.com)",
      accept: "application/geo+json",
    },
  ]);
});

it("parses alerts, carrying reference ids and the hazard window", async () => {
  const { client } = clientFor([alertsResponse(ALERT)]);

  const alerts = await Effect.runPromise(client.activeAlerts(KANSAS_CITY));

  expect(alerts).toEqual([
    {
      id: "urn:oid:alert-2",
      event: "Winter Storm Warning",
      headline: "Winter Storm Warning until Saturday",
      severity: "Severe",
      certainty: "Likely",
      urgency: "Expected",
      messageType: "Update",
      references: ["urn:oid:alert-1"],
      hazardWindow: {
        start: "2026-01-09T18:00:00-06:00",
        end: "2026-01-10T12:00:00-06:00",
        endBasis: "ends",
      },
    },
  ]);
});

it("fails with a schema error when a payload lacks a required field", async () => {
  const { event: _omitted, ...alertWithoutEvent } = ALERT;
  const { client } = clientFor([alertsResponse(alertWithoutEvent)]);

  const error = await Effect.runPromise(
    Effect.flip(client.activeAlerts(KANSAS_CITY)),
  );

  expect(error.reason).toEqual({
    kind: "schema",
    errors: [
      "/features/0/properties/event Expected required property",
      "/features/0/properties/event Expected string",
    ],
  });
});

it.each([HTTP_FORBIDDEN, HTTP_SERVICE_UNAVAILABLE])(
  "retries a %i and returns the next successful response",
  async (status) => {
    const { client, sent } = clientFor([
      new Response(null, { status }),
      alertsResponse(ALERT),
    ]);

    const alerts = await Effect.runPromise(client.activeAlerts(KANSAS_CITY));

    expect([sent.length, alerts.map(({ id }) => id)]).toEqual([
      2,
      ["urn:oid:alert-2"],
    ]);
  },
);

it("fails a 404 with its status after one request", async () => {
  const { client, sent } = clientFor([
    new Response(null, { status: HTTP_NOT_FOUND }),
  ]);

  const error = await Effect.runPromise(
    Effect.flip(client.forecast(KANSAS_CITY)),
  );

  expect([sent.length, error.reason, error.message]).toEqual([
    1,
    { kind: "status", status: 404 },
    "NWS request failed (HTTP 404): http://nws.test/points/39.0997,-94.5786",
  ]);
});
it("keeps an hourly period whose values NWS reports as missing", async () => {
  const { client } = clientFor([
    pointsResponse(),
    Response.json({
      properties: {
        updateTime: "2026-10-11T01:43:12+00:00",
        periods: [
          {
            startTime: "2026-10-11T02:00:00-05:00",
            endTime: "2026-10-11T03:00:00-05:00",
            isDaytime: false,
            temperature: null,
            temperatureUnit: null,
            windSpeed: null,
            windDirection: null,
            shortForecast: null,
            probabilityOfPrecipitation: { value: null },
          },
        ],
      },
    }),
  ]);

  const { periods } = await Effect.runPromise(
    client.hourlyForecast(KANSAS_CITY),
  );

  expect(periods).toEqual([
    {
      startTime: "2026-10-11T02:00:00-05:00",
      endTime: "2026-10-11T03:00:00-05:00",
      isDaytime: false,
      temperature: null,
      temperatureUnit: null,
      windSpeed: null,
      windDirection: null,
      shortForecast: null,
      probabilityOfPrecipitation: null,
    },
  ]);
});

it("keeps the hourly forecast's update time and URL", async () => {
  const { client } = clientFor([
    pointsResponse(),
    Response.json({
      properties: { updateTime: "2026-10-11T01:43:12+00:00", periods: [] },
    }),
  ]);

  const forecast = await Effect.runPromise(client.hourlyForecast(KANSAS_CITY));

  expect(forecast).toEqual({
    rawRef: "http://nws.test/gridpoints/EAX/44,51/forecast/hourly",
    updateTime: "2026-10-11T01:43:12+00:00",
    periods: [],
  });
});

it("reads each active alert with its inline geometry and affected zone URLs", async () => {
  const polygon = { type: "Polygon", coordinates: [squareRing(KANSAS_CITY)] };
  const { client, sent } = clientFor([
    Response.json({
      features: [
        {
          geometry: polygon,
          properties: {
            ...ALERT,
            affectedZones: ["http://nws.test/zones/forecast/MOZ037"],
          },
        },
      ],
    }),
  ]);

  const [area] = await Effect.runPromise(client.activeAlertAreas(KANSAS_CITY));

  expect([
    sent.map(({ url }) => url),
    area?.alert.id,
    area?.geometry,
    area?.affectedZones,
  ]).toEqual([
    ["http://nws.test/alerts/active?point=39.0997,-94.5786&status=actual"],
    "urn:oid:alert-2",
    polygon,
    ["http://nws.test/zones/forecast/MOZ037"],
  ]);
});

it("fetches a zone URL as given and returns its geometry", async () => {
  const multiPolygon = {
    type: "MultiPolygon",
    coordinates: [[squareRing(KANSAS_CITY)]],
  };
  const { client, sent } = clientFor([
    Response.json({ geometry: multiPolygon }),
  ]);

  const geometry = await Effect.runPromise(
    client.zoneGeometry("https://zones.test/zones/forecast/MOZ037"),
  );

  expect([sent.map(({ url }) => url), geometry]).toEqual([
    ["https://zones.test/zones/forecast/MOZ037"],
    multiPolygon,
  ]);
});
