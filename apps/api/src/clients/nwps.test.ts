import { Effect } from "effect";
import { expect, it } from "vitest";
import {
  FORECAST_URL,
  GAUGE_URL,
  KCDM7,
  KCDM7_FORECAST_BODY,
  KCDM7_GAUGE_BODY,
  nwpsClientFor,
} from "./nwps-test-client";

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVICE_UNAVAILABLE = 503;
const NOT_FOUND_BODY =
  '{"code":5,"message":"[KCDM7] could not find gauge ID","details":[]}';
// -999 is NWPS's missing observation; -9999 its missing flood stage.
const MISSING_OBSERVED_GAUGE_BODY = KCDM7_GAUGE_BODY.replace(
  '"primary":14.94',
  '"primary":-999',
).replace('"moderate":{"stage":35', '"moderate":{"stage":-9999');
const MISSING_POINT_FORECAST_BODY =
  '{"primaryUnits":"ft","data":[{"validTime":"2026-10-11T06:00:00Z","primary":-999},{"validTime":"2026-10-11T12:00:00Z","primary":-0.4}]}';

function response(body: string, status = HTTP_OK): Response {
  return new Response(body, { status });
}

it("reads a gauge's flood stages, observation, and forecast", async () => {
  const { client } = nwpsClientFor({
    [GAUGE_URL]: [response(KCDM7_GAUGE_BODY)],
    [FORECAST_URL]: [response(KCDM7_FORECAST_BODY)],
  });

  const gauge = await Effect.runPromise(client.gauge(KCDM7));

  expect(gauge).toEqual({
    lid: "KCDM7",
    name: "Missouri River at Kansas City",
    rawRef: GAUGE_URL,
    floodStagesFt: { action: 29, minor: 32, moderate: 35, major: 49 },
    observed: { stageFt: 14.94, validTime: "2026-10-11T00:30:00Z" },
    forecast: [
      { stageFt: 15.1, validTime: "2026-10-11T06:00:00Z" },
      { stageFt: 15, validTime: "2026-10-11T12:00:00Z" },
    ],
  });
});

it("reads NWPS missing-value sentinels as absent but keeps real negative stages", async () => {
  const { client } = nwpsClientFor({
    [GAUGE_URL]: [response(MISSING_OBSERVED_GAUGE_BODY)],
    [FORECAST_URL]: [response(MISSING_POINT_FORECAST_BODY)],
  });

  const gauge = await Effect.runPromise(client.gauge(KCDM7));

  expect({
    floodStagesFt: gauge.floodStagesFt,
    observed: gauge.observed,
    forecast: gauge.forecast,
  }).toEqual({
    floodStagesFt: { action: 29, minor: 32, major: 49 },
    observed: undefined,
    forecast: [{ stageFt: -0.4, validTime: "2026-10-11T12:00:00Z" }],
  });
});

it("fails on 404 without retrying", async () => {
  const { client, urls } = nwpsClientFor({
    [GAUGE_URL]: [
      response(NOT_FOUND_BODY, HTTP_NOT_FOUND),
      response(KCDM7_GAUGE_BODY),
    ],
    [FORECAST_URL]: [response(KCDM7_FORECAST_BODY)],
  });

  const error = await Effect.runPromise(Effect.flip(client.gauge(KCDM7)));

  expect({
    reason: error.reason,
    gaugeRequests: urls.filter((url) => url === GAUGE_URL).length,
  }).toEqual({
    reason: { kind: "status", status: HTTP_NOT_FOUND },
    gaugeRequests: 1,
  });
});

it("retries a 503 and returns the next successful response", async () => {
  const { client, urls } = nwpsClientFor({
    [GAUGE_URL]: [
      response("", HTTP_SERVICE_UNAVAILABLE),
      response(KCDM7_GAUGE_BODY),
    ],
    [FORECAST_URL]: [response(KCDM7_FORECAST_BODY)],
  });

  const gauge = await Effect.runPromise(client.gauge(KCDM7));

  expect({
    observed: gauge.observed,
    gaugeRequests: urls.filter((url) => url === GAUGE_URL).length,
  }).toEqual({
    observed: { stageFt: 14.94, validTime: "2026-10-11T00:30:00Z" },
    gaugeRequests: 2,
  });
});
