import process from "node:process";
import { Value } from "@sinclair/typebox/value";
import { Effect } from "effect";
import { t } from "elysia";
import { expect, it } from "vitest";
import {
  observationReadings,
  ReadingSchema,
} from "../features/closure/readings";
import { makeNwsClient } from "./nws";

const userAgent = process.env.NWS_USER_AGENT ?? "";
const KANSAS_CITY = { lat: 39.0997, lon: -94.5786 };
// Four live pulls, each allowed its own timeout and retries.
const LIVE_PULL_TIMEOUT_MS = 60_000;

it("pulls live NWS data for Kansas City and normalizes it", {
  skip: userAgent === "",
  timeout: LIVE_PULL_TIMEOUT_MS,
}, async () => {
  const nws = makeNwsClient({ userAgent });

  const { alerts, forecast, hourlyForecast, observation } =
    await Effect.runPromise(
      Effect.all(
        {
          alerts: nws.activeAlerts(KANSAS_CITY),
          forecast: nws.forecast(KANSAS_CITY),
          hourlyForecast: nws.hourlyForecast(KANSAS_CITY),
          observation: nws.latestObservation(KANSAS_CITY),
        },
        { concurrency: "unbounded" },
      ),
    );

  expect({
    hasForecast: forecast.length > 0,
    hasHourlyForecast: hourlyForecast.length > 0,
    readingsMatchSchema: Value.Check(
      t.Array(ReadingSchema),
      observationReadings(observation),
    ),
    alertEndsAreDates: alerts.every(
      ({ hazardWindow }) => !Number.isNaN(Date.parse(hazardWindow.end)),
    ),
    observationFromItsStation: observation.rawRef.startsWith(
      `https://api.weather.gov/stations/${observation.stationId}/observations/`,
    ),
  }).toEqual({
    hasForecast: true,
    hasHourlyForecast: true,
    readingsMatchSchema: true,
    alertEndsAreDates: true,
    observationFromItsStation: true,
  });
});
