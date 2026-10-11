import { Value } from "@sinclair/typebox/value";
import { Cause, Data, Effect, Schedule } from "effect";
import { type Static, t } from "elysia";
import type { GeoPoint } from "./nws-model";

const AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
// One name for both the requested variable and the response key it comes back under.
const US_AQI = "us_aqi";
const TIME_FORMAT = "unixtime";
const REQUEST_TIMEOUT_MS = 10_000;
const RETRY_BASE_DELAY_MS = 200;
const MAX_RETRIES = 3;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR_MIN = 500;
const MILLIS_PER_SECOND = 1000;

const ResponseSchema = t.Object({
  current: t.Object({
    time: t.Integer(),
    // Null where CAMS has no coverage for the point.
    [US_AQI]: t.Union([t.Integer({ minimum: 0 }), t.Null()]),
  }),
});
type AirQualityResponse = Static<typeof ResponseSchema>;

interface AirQualityObservation {
  readonly aqi: number;
  /** ISO 8601 UTC instant. */
  readonly observedAt: string;
  readonly rawRef: string;
}

type OpenMeteoErrorReason =
  | { readonly kind: "request"; readonly cause: unknown }
  | { readonly kind: "status"; readonly status: number }
  | { readonly kind: "schema"; readonly detail: string };

class OpenMeteoError extends Data.TaggedError("OpenMeteoError")<{
  readonly reason: OpenMeteoErrorReason;
}> {}

type CurrentAqiEffect = Effect.Effect<
  AirQualityObservation | undefined,
  OpenMeteoError
>;

interface OpenMeteoClientShape {
  /** Current modeled (CAMS) US AQI, or undefined where the model has no value. */
  readonly currentAqi: (point: GeoPoint) => CurrentAqiEffect;
}

/** The slice of `fetch` the client uses, so tests can pass a plain function. */
type OpenMeteoFetch = (
  url: URL,
  init: { readonly signal: AbortSignal },
) => Promise<Response>;

function isRetryable(reason: OpenMeteoErrorReason): boolean {
  switch (reason.kind) {
    case "request":
      return true;
    case "status":
      return (
        reason.status === HTTP_TOO_MANY_REQUESTS ||
        reason.status >= HTTP_SERVER_ERROR_MIN
      );
    case "schema":
      return false;
    default:
      return reason satisfies never;
  }
}

function schemaError(detail: string): OpenMeteoError {
  return new OpenMeteoError({ reason: { kind: "schema", detail } });
}

function airQualityUrl({ lat, lon }: GeoPoint): URL {
  const url = new URL(AIR_QUALITY_URL);
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("current", US_AQI);
  url.searchParams.set("timeformat", TIME_FORMAT);
  return url;
}

function describeSchemaMismatch(json: unknown): string {
  const [first] = Value.Errors(ResponseSchema, json);
  if (first === undefined) {
    return "response does not match schema";
  }
  return `${first.path}: ${first.message}`;
}

function toObservation(
  { current }: AirQualityResponse,
  url: URL,
): AirQualityObservation | undefined {
  const aqi = current[US_AQI];
  if (aqi === null) {
    return undefined;
  }
  return {
    aqi,
    observedAt: new Date(current.time * MILLIS_PER_SECOND).toISOString(),
    rawRef: url.href,
  };
}

function decode(body: string, url: URL): CurrentAqiEffect {
  return Effect.gen(function* () {
    const json = yield* Effect.try({
      try: (): unknown => JSON.parse(body),
      catch: () => schemaError("response body is not JSON"),
    });
    if (!Value.Check(ResponseSchema, json)) {
      return yield* Effect.fail(schemaError(describeSchemaMismatch(json)));
    }
    return toObservation(json, url);
  });
}

function requestBody(
  fetchImpl: OpenMeteoFetch,
  url: URL,
): Effect.Effect<string, OpenMeteoError> {
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await fetchImpl(url, { signal });
      return { response, body: await response.text() };
    },
    catch: (cause) =>
      new OpenMeteoError({ reason: { kind: "request", cause } }),
  }).pipe(
    Effect.flatMap(({ response, body }) => {
      if (!response.ok) {
        return Effect.fail(
          new OpenMeteoError({
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
          new OpenMeteoError({
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

function makeOpenMeteoClient(
  fetchImpl: OpenMeteoFetch = globalThis.fetch,
): OpenMeteoClientShape {
  return {
    currentAqi: (point: GeoPoint): CurrentAqiEffect => {
      const url = airQualityUrl(point);
      return requestBody(fetchImpl, url).pipe(
        Effect.flatMap((body) => decode(body, url)),
      );
    },
  };
}

export type {
  AirQualityObservation,
  OpenMeteoClientShape,
  OpenMeteoErrorReason,
  OpenMeteoFetch,
};
export { makeOpenMeteoClient, OpenMeteoError };
