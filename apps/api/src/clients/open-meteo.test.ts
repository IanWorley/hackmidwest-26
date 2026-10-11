import { Effect } from "effect";
import { expect, it } from "vitest";
import { makeOpenMeteoClient, type OpenMeteoFetch } from "./open-meteo";

const KANSAS_CITY = { lat: 39.1, lon: -94.58 };
const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_SERVICE_UNAVAILABLE = 503;
const REQUEST_URL =
  "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=39.1&longitude=-94.58&current=us_aqi&timeformat=unixtime";

// Raw wire text, as Open-Meteo sends it with timeformat=unixtime.
const CANNED_BODY =
  '{"latitude":39.100006,"longitude":-94.6,"utc_offset_seconds":0,"timezone":"GMT","current_units":{"time":"unixtime","interval":"seconds","us_aqi":"USAQI"},"current":{"time":1791680400,"interval":3600,"us_aqi":158}}';
const NO_COVERAGE_BODY =
  '{"current":{"time":1791680400,"interval":3600,"us_aqi":null}}';
const BAD_REQUEST_BODY =
  '{"reason":"Latitude must be in range of -90 to 90°. Given: 999.0.","error":true}';

function response(body: string, status = HTTP_OK): Response {
  return new Response(body, { status });
}

/** Answers each call with the next queued response and records the URLs requested. */
function fakeFetch(responses: readonly Response[]): {
  readonly fetch: OpenMeteoFetch;
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

it("reads the current US AQI as a UTC observation that cites its request", async () => {
  const { fetch, urls } = fakeFetch([response(CANNED_BODY)]);

  const observation = await Effect.runPromise(
    makeOpenMeteoClient(fetch).currentAqi(KANSAS_CITY),
  );

  expect({ observation, urls: urls.map((url) => url.href) }).toEqual({
    observation: {
      aqi: 158,
      observedAt: "2026-10-11T01:00:00.000Z",
      rawRef: REQUEST_URL,
    },
    urls: [REQUEST_URL],
  });
});

it("returns no observation where the model has no AQI for the point", async () => {
  const { fetch } = fakeFetch([response(NO_COVERAGE_BODY)]);

  const observation = await Effect.runPromise(
    makeOpenMeteoClient(fetch).currentAqi(KANSAS_CITY),
  );

  expect(observation).toBeUndefined();
});

it("fails on 400 without retrying", async () => {
  const { fetch, urls } = fakeFetch([
    response(BAD_REQUEST_BODY, HTTP_BAD_REQUEST),
    response(CANNED_BODY),
  ]);

  const error = await Effect.runPromise(
    Effect.flip(makeOpenMeteoClient(fetch).currentAqi(KANSAS_CITY)),
  );

  expect({ reason: error.reason, requests: urls.length }).toEqual({
    reason: { kind: "status", status: HTTP_BAD_REQUEST },
    requests: 1,
  });
});

it("retries a 503 and returns the next successful response", async () => {
  const { fetch, urls } = fakeFetch([
    response("", HTTP_SERVICE_UNAVAILABLE),
    response(CANNED_BODY),
  ]);

  const observation = await Effect.runPromise(
    makeOpenMeteoClient(fetch).currentAqi(KANSAS_CITY),
  );

  expect({ aqi: observation?.aqi, requests: urls.length }).toEqual({
    aqi: 158,
    requests: 2,
  });
});

it("fails with a schema error when the body does not match the Open-Meteo shape", async () => {
  const { fetch } = fakeFetch([response('{"current":{"us_aqi":42}}')]);

  const error = await Effect.runPromise(
    Effect.flip(makeOpenMeteoClient(fetch).currentAqi(KANSAS_CITY)),
  );

  expect(error.reason).toEqual({
    kind: "schema",
    detail: "/current/time: Expected required property",
  });
});
