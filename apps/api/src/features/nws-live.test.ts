import { createTestDatabase } from "@hackmidwest/db/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { makeNwpsClient } from "../clients/nwps";
import { type NwsClientShape, NwsError } from "../clients/nws";
import { makeOpenMeteoClient } from "../clients/open-meteo";
import {
  createApiRuntime,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
  INTERNAL_ERROR_MESSAGE,
} from "../runtime";
import { NWS_LIVE_PATH } from "./nws-live";

const REQUEST_ORIGIN = "http://api.test";
const WEB_ORIGIN = "http://web.test";
const HTTP_UNPROCESSABLE = 422;
const OBSERVATION_URL =
  "https://api.weather.gov/stations/KMKC/observations/2026-10-11T00:30:00+00:00";

const PERIOD = {
  startTime: "2026-10-10T18:00:00-05:00",
  endTime: "2026-10-11T06:00:00-05:00",
  isDaytime: false,
  temperature: 66,
  temperatureUnit: "F",
  windSpeed: "8 mph",
  windDirection: "S",
  shortForecast: "Clear",
  probabilityOfPrecipitation: 0,
};

const NO_VALUE = { value: null, unitCode: "wmoUnit:km_h-1" };

const quietWeather: NwsClientShape = {
  activeAlerts: () => Effect.succeed([]),
  forecast: () => Effect.succeed([PERIOD]),
  hourlyForecast: () => Effect.succeed([]),
  latestObservation: () =>
    Effect.succeed({
      stationId: "KMKC",
      timestamp: "2026-10-11T00:30:00+00:00",
      rawRef: OBSERVATION_URL,
      temperature: { value: 28, unitCode: "wmoUnit:degC" },
      windSpeed: NO_VALUE,
      windGust: NO_VALUE,
      visibility: { value: null, unitCode: "wmoUnit:m" },
    }),
};

const notFound = new NwsError({
  url: "https://api.weather.gov/points/51.5,-0.12",
  reason: { kind: "status", status: HTTP_NOT_FOUND },
});
const outsideCoverage: NwsClientShape = {
  activeAlerts: () => Effect.fail(notFound),
  forecast: () => Effect.fail(notFound),
  hourlyForecast: () => Effect.fail(notFound),
  latestObservation: () => Effect.fail(notFound),
};

async function getLive(nws: NwsClientShape, query: string): Promise<Response> {
  const store = await createTestDatabase();
  const runtime = createApiRuntime(store.db, {
    nws,
    nwps: makeNwpsClient(),
    openMeteo: makeOpenMeteoClient(),
  });
  try {
    const app = createApp({
      runRequest: runtime.runRequest,
      webOrigin: WEB_ORIGIN,
    });
    return await app.handle(
      new Request(new URL(`${NWS_LIVE_PATH}?${query}`, REQUEST_ORIGIN)),
    );
  } finally {
    try {
      await runtime.dispose();
    } finally {
      store.close();
    }
  }
}

describe(`GET ${NWS_LIVE_PATH}`, () => {
  it("returns the point's alerts, forecasts, and normalized readings", async () => {
    const response = await getLive(quietWeather, "lat=39.0997&lon=-94.5786");

    expect(response.status).toBe(HTTP_OK);
    expect(await response.json()).toEqual({
      point: { lat: 39.0997, lon: -94.5786 },
      alerts: [],
      forecast: [PERIOD],
      hourlyForecast: [],
      readings: [
        {
          source: "nws",
          observedAt: "2026-10-11T00:30:00+00:00",
          metric: "temperature",
          value: 28,
          unit: "degC",
          rawRef: OBSERVATION_URL,
        },
      ],
    });
  });

  it("returns a generic 500 when NWS fails", async () => {
    const response = await getLive(outsideCoverage, "lat=51.5&lon=-0.12");

    expect(response.status).toBe(HTTP_INTERNAL_SERVER_ERROR);
    expect(await response.json()).toEqual({ message: INTERNAL_ERROR_MESSAGE });
  });

  it("rejects a latitude outside -90..90", async () => {
    const response = await getLive(quietWeather, "lat=91&lon=-94.5786");

    expect(response.status).toBe(HTTP_UNPROCESSABLE);
  });
});
