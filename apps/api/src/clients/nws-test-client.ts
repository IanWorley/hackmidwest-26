import { makeNwsClient, type NwsClientShape } from "./nws";
import type { GeoPoint } from "./nws-model";

const BASE_URL = "http://nws.test";
const USER_AGENT = "hackmidwest-26 test (ops@example.com)";
const KANSAS_CITY = { lat: 39.099_712, lon: -94.578_561 };
const RING_SIZE_DEGREES = 0.1;

interface SentRequest {
  readonly url: string;
  readonly userAgent: string | null;
  readonly accept: string | null;
}

/** A client whose requests are answered from `responses` in order and recorded in `sent`. */
function clientFor(responses: Response[]): {
  readonly client: NwsClientShape;
  readonly sent: SentRequest[];
} {
  const sent: SentRequest[] = [];
  function fetch(url: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    sent.push({
      url,
      userAgent: headers.get("User-Agent"),
      accept: headers.get("Accept"),
    });
    const response = responses.shift();
    if (response === undefined) {
      return Promise.reject(new Error(`unexpected request to ${url}`));
    }
    return Promise.resolve(response);
  }
  return {
    client: makeNwsClient({ userAgent: USER_AGENT, fetch, baseUrl: BASE_URL }),
    sent,
  };
}

function alertsResponse(properties: object): Response {
  return Response.json({ features: [{ properties }] });
}

function pointsResponse(): Response {
  return Response.json({
    properties: {
      gridId: "EAX",
      gridX: 44,
      gridY: 51,
      forecast: "http://nws.test/gridpoints/EAX/44,51/forecast",
      forecastHourly: "http://nws.test/gridpoints/EAX/44,51/forecast/hourly",
      observationStations: "http://nws.test/gridpoints/EAX/44,51/stations",
    },
  });
}

function emptyForecastResponse(): Response {
  return Response.json({
    properties: { updateTime: "2026-10-11T00:00:00+00:00", periods: [] },
  });
}

/** A closed GeoJSON ring, [lon, lat] pairs, around a square whose south-west corner is the point. */
function squareRing({ lat, lon }: GeoPoint): number[][] {
  const north = lat + RING_SIZE_DEGREES;
  const east = lon + RING_SIZE_DEGREES;
  return [
    [lon, lat],
    [east, lat],
    [east, north],
    [lon, north],
    [lon, lat],
  ];
}

export {
  alertsResponse,
  clientFor,
  emptyForecastResponse,
  KANSAS_CITY,
  pointsResponse,
  squareRing,
};
