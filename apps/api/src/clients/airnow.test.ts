import { Effect } from "effect";
import { expect, it } from "vitest";
import { type AirNowFetch, makeAirNowClient } from "./airnow";

const KANSAS_CITY = { lat: 39.1, lon: -94.58 };
const TEST_API_KEY = "test-key";
const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_SERVICE_UNAVAILABLE = 503;

// Raw wire text, as AirNow sends it, including the padded DateObserved.
const CANNED_BODY = `[
  {"DateObserved":"2026-10-10 ","HourObserved":19,"LocalTimeZone":"CDT","ReportingArea":"Kansas City","StateCode":"MO","Latitude":39.1,"Longitude":-94.58,"ParameterName":"O3","AQI":42,"Category":{"Number":1,"Name":"Good"}},
  {"DateObserved":"2026-01-15 ","HourObserved":7,"LocalTimeZone":"CST","ReportingArea":"Kansas City","StateCode":"MO","Latitude":39.1,"Longitude":-94.58,"ParameterName":"PM2.5","AQI":58,"Category":{"Number":2,"Name":"Moderate"}},
  {"DateObserved":"2026-10-10 ","HourObserved":19,"LocalTimeZone":"CDT","ReportingArea":"Kansas City","StateCode":"MO","Latitude":39.1,"Longitude":-94.58,"ParameterName":"PM10","AQI":-1,"Category":{"Number":7,"Name":"Unavailable"}},
  {"DateObserved":"2026-10-10 ","HourObserved":19,"LocalTimeZone":"CDT","ReportingArea":"Kansas City","StateCode":"MO","Latitude":39.1,"Longitude":-94.58,"ParameterName":"NO2","AQI":20,"Category":{"Number":1,"Name":"Good"}}
]`;
const UNAUTHORIZED_BODY =
  '{"WebServiceError":[{"Message":"Invalid request or API key."}]}';

const EXPECTED_OBSERVATIONS = [
  {
    parameter: "O3",
    aqi: 42,
    category: "Good",
    reportingArea: "Kansas City",
    observedAt: "2026-10-11T00:00:00.000Z",
    rawRef: "airnow:Kansas City:O3:2026-10-11T00:00:00.000Z",
  },
  {
    parameter: "PM2.5",
    aqi: 58,
    category: "Moderate",
    reportingArea: "Kansas City",
    observedAt: "2026-01-15T13:00:00.000Z",
    rawRef: "airnow:Kansas City:PM2.5:2026-01-15T13:00:00.000Z",
  },
];

function response(body: string, status = HTTP_OK): Response {
  return new Response(body, { status });
}

/** Answers each call with the next queued response and records the URLs requested. */
function fakeFetch(responses: readonly Response[]): {
  readonly fetch: AirNowFetch;
  readonly urls: readonly URL[];
} {
  const urls: URL[] = [];
  return {
    urls,
    fetch: (url: URL): Promise<Response> => {
      const next = responses[urls.length];
      urls.push(url);
      if (next === undefined) {
        return Promise.reject(new Error("unexpected fetch"));
      }
      return Promise.resolve(next);
    },
  };
}

it("parses observations to UTC and drops no-data and unknown parameters", async () => {
  const { fetch, urls } = fakeFetch([response(CANNED_BODY)]);
  const client = makeAirNowClient({ apiKey: TEST_API_KEY, fetch });

  const observations = await Effect.runPromise(
    client.currentObservations(KANSAS_CITY),
  );

  expect(observations).toEqual(EXPECTED_OBSERVATIONS);
  expect(
    urls.map((url) => [`${url.origin}${url.pathname}`, [...url.searchParams]]),
  ).toEqual([
    [
      "https://www.airnowapi.org/aq/observation/latLong/current/",
      [
        ["format", "application/json"],
        ["latitude", "39.1"],
        ["longitude", "-94.58"],
        ["distance", "25"],
        ["API_KEY", "test-key"],
      ],
    ],
  ]);
});

it("returns no observations without calling AirNow when no key is configured", async () => {
  const { fetch, urls } = fakeFetch([response(CANNED_BODY)]);
  const client = makeAirNowClient({ apiKey: undefined, fetch });

  const observations = await Effect.runPromise(
    client.currentObservations(KANSAS_CITY),
  );

  expect({ observations, requests: urls.length }).toEqual({
    observations: [],
    requests: 0,
  });
});

it("fails on 401 without retrying", async () => {
  const { fetch, urls } = fakeFetch([
    response(UNAUTHORIZED_BODY, HTTP_UNAUTHORIZED),
    response(CANNED_BODY),
  ]);
  const client = makeAirNowClient({ apiKey: TEST_API_KEY, fetch });

  const error = await Effect.runPromise(
    Effect.flip(client.currentObservations(KANSAS_CITY)),
  );

  expect({ reason: error.reason, requests: urls.length }).toEqual({
    reason: { kind: "status", status: HTTP_UNAUTHORIZED },
    requests: 1,
  });
});

it("retries a 503 and returns the next successful response", async () => {
  const { fetch, urls } = fakeFetch([
    response("", HTTP_SERVICE_UNAVAILABLE),
    response(CANNED_BODY),
  ]);
  const client = makeAirNowClient({ apiKey: TEST_API_KEY, fetch });

  const observations = await Effect.runPromise(
    client.currentObservations(KANSAS_CITY),
  );

  expect({ observations, requests: urls.length }).toEqual({
    observations: EXPECTED_OBSERVATIONS,
    requests: 2,
  });
});

it("fails with a schema error when the body does not match the AirNow shape", async () => {
  const { fetch } = fakeFetch([response('[{"AQI":42}]')]);
  const client = makeAirNowClient({ apiKey: TEST_API_KEY, fetch });

  const error = await Effect.runPromise(
    Effect.flip(client.currentObservations(KANSAS_CITY)),
  );

  expect(error.reason).toEqual({
    kind: "schema",
    detail: "/0/DateObserved: Expected required property",
  });
});
