import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { Cause, Context, Data, Effect, Schedule } from "effect";

const AIR_NOW_OBSERVATIONS_URL =
  "https://www.airnowapi.org/aq/observation/latLong/current/";
const RESPONSE_FORMAT = "application/json";
const SEARCH_RADIUS_MILES = 25;
const REQUEST_TIMEOUT_MS = 10_000;
const RETRY_BASE_DELAY_MS = 200;
const MAX_RETRIES = 3;
const HTTP_SERVER_ERROR_MIN = 500;
const NO_DATA_AQI = -1;
const LAST_HOUR_OF_DAY = 23;
const HOUR_DIGITS = 2;

const AIR_NOW_PARAMETERS = ["O3", "PM2.5", "PM10"] as const;
type AirNowParameter = (typeof AIR_NOW_PARAMETERS)[number];

// AirNow reports local wall-clock time with a US zone abbreviation, not an offset.
const UTC_OFFSETS: ReadonlyMap<string, string> = new Map([
  ["AST", "-04:00"],
  ["EST", "-05:00"],
  ["EDT", "-04:00"],
  ["CST", "-06:00"],
  ["CDT", "-05:00"],
  ["MST", "-07:00"],
  ["MDT", "-06:00"],
  ["PST", "-08:00"],
  ["PDT", "-07:00"],
  ["AKST", "-09:00"],
  ["AKDT", "-08:00"],
  ["HST", "-10:00"],
]);

const ParameterSchema = Type.Union(
  AIR_NOW_PARAMETERS.map((parameter) => Type.Literal(parameter)),
);

const RawObservationSchema = Type.Object({
  // AirNow pads the date with a trailing space.
  DateObserved: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2} ?$" }),
  HourObserved: Type.Integer({ minimum: 0, maximum: LAST_HOUR_OF_DAY }),
  LocalTimeZone: Type.String(),
  ReportingArea: Type.String(),
  ParameterName: Type.String(),
  AQI: Type.Integer({ minimum: NO_DATA_AQI }),
  Category: Type.Object({ Name: Type.String() }),
});
type RawObservation = Static<typeof RawObservationSchema>;

const ResponseSchema = Type.Array(RawObservationSchema);

interface AirNowObservation {
  readonly parameter: AirNowParameter;
  readonly aqi: number;
  readonly category: string;
  readonly reportingArea: string;
  /** ISO 8601 UTC instant. */
  readonly observedAt: string;
  readonly rawRef: string;
}

type AirNowErrorReason =
  | { readonly kind: "request"; readonly cause: unknown }
  | { readonly kind: "status"; readonly status: number }
  | { readonly kind: "schema"; readonly detail: string };

class AirNowError extends Data.TaggedError("AirNowError")<{
  readonly reason: AirNowErrorReason;
}> {}

type ObservationsEffect = Effect.Effect<
  readonly AirNowObservation[],
  AirNowError
>;

interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
}

interface AirNowClientShape {
  readonly currentObservations: (point: GeoPoint) => ObservationsEffect;
}

// Function-style key because the strict lint config allows one class per file.
const AirNowClient = Context.Service<AirNowClientShape>(
  "@hackmidwest/api/AirNowClient",
);

/** The slice of `fetch` the client uses, so tests can pass a plain function. */
type AirNowFetch = (
  url: URL,
  init: { readonly signal: AbortSignal },
) => Promise<Response>;

interface AirNowClientOptions {
  readonly apiKey: string | undefined;
  readonly fetch: AirNowFetch;
}

function isRetryable(reason: AirNowErrorReason): boolean {
  switch (reason.kind) {
    case "request":
      return true;
    case "status":
      return reason.status >= HTTP_SERVER_ERROR_MIN;
    case "schema":
      return false;
    default:
      return reason satisfies never;
  }
}

function schemaError(detail: string): AirNowError {
  return new AirNowError({ reason: { kind: "schema", detail } });
}

function observationsUrl(point: GeoPoint, apiKey: string): URL {
  const url = new URL(AIR_NOW_OBSERVATIONS_URL);
  url.searchParams.set("format", RESPONSE_FORMAT);
  url.searchParams.set("latitude", String(point.latitude));
  url.searchParams.set("longitude", String(point.longitude));
  url.searchParams.set("distance", String(SEARCH_RADIUS_MILES));
  url.searchParams.set("API_KEY", apiKey);
  return url;
}

function toObservation(
  raw: RawObservation,
  parameter: AirNowParameter,
): Effect.Effect<AirNowObservation, AirNowError> {
  const offset = UTC_OFFSETS.get(raw.LocalTimeZone);
  if (offset === undefined) {
    return Effect.fail(
      schemaError(`unknown time zone abbreviation "${raw.LocalTimeZone}"`),
    );
  }
  const hour = String(raw.HourObserved).padStart(HOUR_DIGITS, "0");
  const instant = new Date(`${raw.DateObserved.trim()}T${hour}:00:00${offset}`);
  if (Number.isNaN(instant.getTime())) {
    return Effect.fail(
      schemaError(`invalid observation date "${raw.DateObserved}"`),
    );
  }
  const observedAt = instant.toISOString();
  return Effect.succeed({
    parameter,
    aqi: raw.AQI,
    category: raw.Category.Name,
    reportingArea: raw.ReportingArea,
    observedAt,
    rawRef: `airnow:${raw.ReportingArea}:${parameter}:${observedAt}`,
  });
}

function describeSchemaMismatch(json: unknown): string {
  const [first] = Value.Errors(ResponseSchema, json);
  if (first === undefined) {
    return "response does not match schema";
  }
  return `${first.path}: ${first.message}`;
}

function decodeObservations(body: string): ObservationsEffect {
  return Effect.gen(function* () {
    const json = yield* Effect.try({
      try: (): unknown => JSON.parse(body),
      catch: () => schemaError("response body is not JSON"),
    });
    if (!Value.Check(ResponseSchema, json)) {
      return yield* Effect.fail(schemaError(describeSchemaMismatch(json)));
    }
    // Unknown pollutants are skipped so a new AirNow parameter cannot break ingestion.
    const reported = json.flatMap((raw) => {
      const parameter = raw.ParameterName;
      if (raw.AQI === NO_DATA_AQI || !Value.Check(ParameterSchema, parameter)) {
        return [];
      }
      return [{ raw, parameter }];
    });
    return yield* Effect.forEach(reported, ({ raw, parameter }) =>
      toObservation(raw, parameter),
    );
  });
}

function requestBody(
  fetchImpl: AirNowFetch,
  url: URL,
): Effect.Effect<string, AirNowError> {
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await fetchImpl(url, { signal });
      return { response, body: await response.text() };
    },
    catch: (cause) => new AirNowError({ reason: { kind: "request", cause } }),
  }).pipe(
    Effect.flatMap(({ response, body }) => {
      if (!response.ok) {
        return Effect.fail(
          new AirNowError({
            reason: { kind: "status", status: response.status },
          }),
        );
      }
      return Effect.succeed(body);
    }),
    Effect.timeoutOrElse({
      duration: REQUEST_TIMEOUT_MS,
      orElse: () =>
        Effect.fail(
          new AirNowError({
            reason: { kind: "request", cause: new Cause.TimeoutError() },
          }),
        ),
    }),
    Effect.retry({
      schedule: Schedule.exponential(RETRY_BASE_DELAY_MS),
      times: MAX_RETRIES,
      while: (error) => isRetryable(error.reason),
    }),
  );
}

function makeAirNowClient(options: AirNowClientOptions): AirNowClientShape {
  const { apiKey, fetch: fetchImpl } = options;
  return {
    currentObservations: (point: GeoPoint): ObservationsEffect => {
      // Without a key there are no readings; the engine lowers confidence instead of failing.
      if (apiKey === undefined) {
        return Effect.succeed([]);
      }
      return requestBody(fetchImpl, observationsUrl(point, apiKey)).pipe(
        Effect.flatMap(decodeObservations),
      );
    },
  };
}

export type {
  AirNowClientOptions,
  AirNowClientShape,
  AirNowErrorReason,
  AirNowFetch,
  AirNowObservation,
  AirNowParameter,
  GeoPoint,
};
export { AIR_NOW_PARAMETERS, AirNowClient, AirNowError, makeAirNowClient };
