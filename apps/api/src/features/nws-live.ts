// Temporary: shows the NWS client end to end until the closure evaluate route replaces it.
import { Effect } from "effect";
import { Elysia, t } from "elysia";
import {
  ForecastPeriodSchema,
  type GeoPoint,
  GeoPointSchema,
  NwsAlertSchema,
} from "../clients/nws-model";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_OK,
  internalServerErrorResponse,
  NwsClient,
  type RunRequest,
} from "../runtime";
import { observationReadings, ReadingSchema } from "./closure/readings";

const NWS_LIVE_PATH = "/api/nws/live";
const MAX_LATITUDE = 90;
const MAX_LONGITUDE = 180;

const liveQuery = t.Object({
  lat: t.Numeric({ minimum: -MAX_LATITUDE, maximum: MAX_LATITUDE }),
  lon: t.Numeric({ minimum: -MAX_LONGITUDE, maximum: MAX_LONGITUDE }),
});

const liveResponse = t.Object({
  point: GeoPointSchema,
  alerts: t.Array(NwsAlertSchema),
  forecast: t.Array(ForecastPeriodSchema),
  hourlyForecast: t.Array(ForecastPeriodSchema),
  readings: t.Array(ReadingSchema),
});

const livePull = Effect.fn("livePull")(function* (point: GeoPoint) {
  const nws = yield* NwsClient;
  const { alerts, forecast, hourlyForecast, observation } = yield* Effect.all(
    {
      alerts: nws.activeAlerts(point),
      forecast: nws.forecast(point),
      hourlyForecast: nws.hourlyForecast(point),
      observation: nws.latestObservation(point),
    },
    { concurrency: "unbounded" },
  );
  return {
    point,
    alerts,
    forecast: forecast.periods,
    hourlyForecast: hourlyForecast.periods,
    readings: observationReadings(observation),
  };
});

export function createNwsLiveModule(runRequest: RunRequest) {
  return new Elysia({ name: "nws-live" }).get(
    NWS_LIVE_PATH,
    ({ query }) => runRequest(livePull(query)),
    {
      query: liveQuery,
      response: {
        [HTTP_OK]: liveResponse,
        [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
      },
    },
  );
}

export { NWS_LIVE_PATH };
