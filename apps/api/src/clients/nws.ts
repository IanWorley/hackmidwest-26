import type { Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { Clock, Data, Duration, Effect, Schedule } from "effect";
import type {
  ForecastPeriod,
  GeoPoint,
  NwsAlert,
  NwsObservation,
} from "./nws-model";
import {
  AlertsResponse,
  ForecastResponse,
  type GridPoint,
  ObservationResponse,
  PointsResponse,
  StationsResponse,
  toForecastPeriod,
  toNwsAlert,
} from "./nws-wire";

const DEFAULT_BASE_URL = "https://api.weather.gov";
const GEOJSON_MEDIA_TYPE = "application/geo+json";
/** api.weather.gov redirects coordinates with more precision than this. */
const COORDINATE_DECIMALS = 4;
const REQUEST_TIMEOUT_SECONDS = 10;
/** Backoff of 1s, 2s, 4s outlasts the roughly 5s NWS documents for a rate limit to clear. */
const RETRY_BASE_DELAY_MILLIS = 1000;
const MAX_RETRIES = 3;
/** NWS signals rate limiting with 403 rather than 429. */
const HTTP_FORBIDDEN = 403;
const HTTP_TOO_MANY_REQUESTS = 429;
/** Matches the s-maxage NWS sends on /points; grid mappings occasionally change. */
const GRID_POINT_TTL_MILLIS = Duration.toMillis(Duration.hours(24));
const HTTP_SERVER_ERROR_MIN = 500;

type NwsErrorReason =
  | { readonly kind: "network"; readonly cause: unknown }
  | { readonly kind: "timeout" }
  | { readonly kind: "status"; readonly status: number }
  | { readonly kind: "schema"; readonly errors: readonly string[] };

function describeReason(reason: NwsErrorReason): string {
  switch (reason.kind) {
    case "status":
      return `HTTP ${reason.status}`;
    case "schema":
      return `unexpected payload: ${reason.errors.join("; ")}`;
    default:
      return reason.kind;
  }
}

class NwsError extends Data.TaggedError("NwsError")<{
  readonly url: string;
  readonly reason: NwsErrorReason;
}> {
  override get message(): string {
    return `NWS request failed (${describeReason(this.reason)}): ${this.url}`;
  }
}

interface NwsClientShape {
  readonly forecast: (
    point: GeoPoint,
  ) => Effect.Effect<ForecastPeriod[], NwsError>;
  readonly hourlyForecast: (
    point: GeoPoint,
  ) => Effect.Effect<ForecastPeriod[], NwsError>;
  readonly activeAlerts: (
    point: GeoPoint,
  ) => Effect.Effect<NwsAlert[], NwsError>;
  readonly latestObservation: (
    point: GeoPoint,
  ) => Effect.Effect<NwsObservation, NwsError>;
}

/** The part of `fetch` the client uses; Bun's full `typeof fetch` cannot be stubbed without a cast. */
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

type GetJson = <Schema extends TSchema>(
  url: string,
  schema: Schema,
) => Effect.Effect<Static<Schema>, NwsError>;

interface NwsClientOptions {
  readonly userAgent: string;
  readonly fetch?: Fetch;
  readonly baseUrl?: string;
}

function isRetryable({ reason }: NwsError): boolean {
  switch (reason.kind) {
    case "network":
    case "timeout":
      return true;
    case "status":
      return (
        reason.status === HTTP_FORBIDDEN ||
        reason.status === HTTP_TOO_MANY_REQUESTS ||
        reason.status >= HTTP_SERVER_ERROR_MIN
      );
    case "schema":
      return false;
    default:
      return reason satisfies never;
  }
}

function roundCoordinate(value: number): number {
  return Number(value.toFixed(COORDINATE_DECIMALS));
}

function pointPath({ lat, lon }: GeoPoint): string {
  return `${roundCoordinate(lat)},${roundCoordinate(lon)}`;
}

/** One GET per attempt: status, JSON, and schema checks run inside the timeout and retry. */
function makeGetJson(fetch: Fetch, userAgent: string): GetJson {
  return (url, schema) => {
    function fail(reason: NwsErrorReason): NwsError {
      return new NwsError({ url, reason });
    }
    return Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          fetch(url, {
            headers: [
              ["User-Agent", userAgent],
              ["Accept", GEOJSON_MEDIA_TYPE],
            ],
            signal,
          }),
        catch: (cause) => fail({ kind: "network", cause }),
      });
      if (!response.ok) {
        return yield* fail({ kind: "status", status: response.status });
      }
      const text = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: (cause) => fail({ kind: "network", cause }),
      });
      const body = yield* Effect.try({
        try: (): unknown => JSON.parse(text),
        catch: (cause) => fail({ kind: "schema", errors: [String(cause)] }),
      });
      if (!Value.Check(schema, body)) {
        const errors = [...Value.Errors(schema, body)];
        return yield* fail({
          kind: "schema",
          errors: errors.map(({ path, message }) => `${path} ${message}`),
        });
      }
      return body;
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.seconds(REQUEST_TIMEOUT_SECONDS),
        orElse: () => Effect.fail(fail({ kind: "timeout" })),
      }),
      Effect.retry({
        schedule: Schedule.exponential(
          Duration.millis(RETRY_BASE_DELAY_MILLIS),
        ),
        times: MAX_RETRIES,
        while: isRetryable,
      }),
    );
  };
}

function forecastPeriods(
  getJson: GetJson,
  url: string,
): Effect.Effect<ForecastPeriod[], NwsError> {
  return getJson(url, ForecastResponse).pipe(
    Effect.map(({ properties }) => properties.periods.map(toForecastPeriod)),
  );
}

function latestObservation(
  getJson: GetJson,
  baseUrl: string,
  grid: GridPoint,
): Effect.Effect<NwsObservation, NwsError> {
  return Effect.gen(function* () {
    const stations = yield* getJson(grid.observationStations, StationsResponse);
    // NWS lists a grid point's stations nearest first.
    const [nearest] = stations.features;
    if (nearest === undefined) {
      return yield* new NwsError({
        url: grid.observationStations,
        reason: { kind: "schema", errors: ["no observation stations"] },
      });
    }
    const stationId = nearest.properties.stationIdentifier;
    const { properties } = yield* getJson(
      `${baseUrl}/stations/${stationId}/observations/latest`,
      ObservationResponse,
    );
    return {
      stationId,
      timestamp: properties.timestamp,
      rawRef: properties["@id"],
      temperature: properties.temperature,
      windSpeed: properties.windSpeed,
      windGust: properties.windGust,
      visibility: properties.visibility,
    };
  });
}

function makeNwsClient({
  userAgent,
  fetch = globalThis.fetch,
  baseUrl = DEFAULT_BASE_URL,
}: NwsClientOptions): NwsClientShape {
  const getJson = makeGetJson(fetch, userAgent);
  const gridPoints = new Map<
    string,
    { readonly grid: GridPoint; readonly expiresAt: number }
  >();

  function gridPoint(point: GeoPoint): Effect.Effect<GridPoint, NwsError> {
    return Effect.gen(function* () {
      const path = pointPath(point);
      const now = yield* Clock.currentTimeMillis;
      const cached = gridPoints.get(path);
      if (cached !== undefined && now < cached.expiresAt) {
        return cached.grid;
      }
      const { properties } = yield* getJson(
        `${baseUrl}/points/${path}`,
        PointsResponse,
      );
      gridPoints.set(path, {
        grid: properties,
        expiresAt: now + GRID_POINT_TTL_MILLIS,
      });
      return properties;
    });
  }

  return {
    forecast: (point) =>
      gridPoint(point).pipe(
        Effect.flatMap((grid) => forecastPeriods(getJson, grid.forecast)),
      ),
    hourlyForecast: (point) =>
      gridPoint(point).pipe(
        Effect.flatMap((grid) => forecastPeriods(getJson, grid.forecastHourly)),
      ),
    activeAlerts: (point) =>
      getJson(
        `${baseUrl}/alerts/active?point=${pointPath(point)}`,
        AlertsResponse,
      ).pipe(
        Effect.map(({ features }) =>
          features.map(({ properties }) => toNwsAlert(properties)),
        ),
      ),
    latestObservation: (point) =>
      gridPoint(point).pipe(
        Effect.flatMap((grid) => latestObservation(getJson, baseUrl, grid)),
      ),
  };
}

export type { NwsClientShape };
export { makeNwsClient, NwsError };
