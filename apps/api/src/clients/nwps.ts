import type { Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { Cause, Data, Effect, Schedule } from "effect";
import { t } from "elysia";

const NWPS_BASE_URL = "https://api.water.noaa.gov/nwps/v1";
const REQUEST_TIMEOUT_MS = 10_000;
const RETRY_BASE_DELAY_MS = 200;
const MAX_RETRIES = 3;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR_MIN = 500;
// Every one of the 12,339 NWPS gauges listed on 2026-10-11 has this shape.
const NWPS_GAUGE_ID_PATTERN = "^[A-Z]{4}[0-9]$";
// Real stages can be negative, so only these exact values mean missing.
const MISSING_STAGE = -999;
const MISSING_FLOOD_STAGE = -9999;
// Some gauges report flow (kcfs) as their primary value, which no stage compares against.
const STAGE_UNIT = "ft";

/** NWS flood categories, least to most severe (NWSM 10-950 §2.8). */
const FLOOD_CATEGORIES = ["action", "minor", "moderate", "major"] as const;
type FloodCategory = (typeof FLOOD_CATEGORIES)[number];

declare const nwpsGaugeIdBrand: unique symbol;
/** An NWS location identifier (`lid`) such as `KCDM7`. */
type NwpsGaugeId = string & { readonly [nwpsGaugeIdBrand]: true };

/** Validating against this schema is the only way to get an `NwpsGaugeId`. */
const NwpsGaugeIdSchema = t.Unsafe<NwpsGaugeId>(
  t.String({ pattern: NWPS_GAUGE_ID_PATTERN }),
);

const FloodStageSchema = t.Object({ stage: t.Number() });

const GaugeResponseSchema = t.Object({
  name: t.String(),
  status: t.Object({
    observed: t.Object({
      primary: t.Number(),
      primaryUnit: t.String(),
      validTime: t.String(),
    }),
  }),
  flood: t.Object({
    stageUnits: t.String(),
    categories: t.Partial(
      t.Object({
        action: FloodStageSchema,
        minor: FloodStageSchema,
        moderate: FloodStageSchema,
        major: FloodStageSchema,
      }),
    ),
  }),
});
type GaugeResponse = Static<typeof GaugeResponseSchema>;

// A gauge without a forecast answers 200 with empty `data` and blank units.
const ForecastResponseSchema = t.Object({
  primaryUnits: t.String(),
  data: t.Array(t.Object({ validTime: t.String(), primary: t.Number() })),
});
type ForecastResponse = Static<typeof ForecastResponseSchema>;

interface StageAt {
  readonly stageFt: number;
  /** ISO 8601 UTC instant. */
  readonly validTime: string;
}

interface RiverGauge {
  readonly lid: NwpsGaugeId;
  readonly name: string;
  readonly rawRef: string;
  /** Only the categories this gauge defines a stage for. */
  readonly floodStagesFt: Partial<Record<FloodCategory, number>>;
  readonly observed: StageAt | undefined;
  readonly forecast: readonly StageAt[];
}

type NwpsErrorReason =
  | { readonly kind: "request"; readonly cause: unknown }
  | { readonly kind: "status"; readonly status: number }
  | { readonly kind: "schema"; readonly detail: string };

class NwpsError extends Data.TaggedError("NwpsError")<{
  readonly url: string;
  readonly reason: NwpsErrorReason;
}> {}

interface NwpsClientShape {
  /** Flood stages, latest observation, and forecast stages for one river gauge. */
  readonly gauge: (lid: NwpsGaugeId) => Effect.Effect<RiverGauge, NwpsError>;
}

/** The slice of `fetch` the client uses, so tests can pass a plain function. */
type NwpsFetch = (
  url: URL,
  init: { readonly signal: AbortSignal },
) => Promise<Response>;

function isRetryable(reason: NwpsErrorReason): boolean {
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

function present(value: number | undefined): number | undefined {
  if (value === MISSING_STAGE || value === MISSING_FLOOD_STAGE) {
    return undefined;
  }
  return value;
}

function stageAt(
  primary: number,
  unit: string,
  validTime: string,
): StageAt | undefined {
  const stageFt = present(primary);
  if (unit !== STAGE_UNIT || stageFt === undefined) {
    return undefined;
  }
  return { stageFt, validTime };
}

function floodStagesFt({
  stageUnits,
  categories,
}: GaugeResponse["flood"]): Partial<Record<FloodCategory, number>> {
  if (stageUnits !== STAGE_UNIT) {
    return {};
  }
  const stages: Partial<Record<FloodCategory, number>> = {};
  for (const category of FLOOD_CATEGORIES) {
    const stageFt = present(categories[category]?.stage);
    if (stageFt !== undefined) {
      stages[category] = stageFt;
    }
  }
  return stages;
}

function toRiverGauge(
  lid: NwpsGaugeId,
  url: URL,
  gauge: GaugeResponse,
  forecast: ForecastResponse,
): RiverGauge {
  const { observed } = gauge.status;
  return {
    lid,
    name: gauge.name,
    rawRef: url.href,
    floodStagesFt: floodStagesFt(gauge.flood),
    observed: stageAt(
      observed.primary,
      observed.primaryUnit,
      observed.validTime,
    ),
    forecast: forecast.data.flatMap((point) => {
      const stage = stageAt(
        point.primary,
        forecast.primaryUnits,
        point.validTime,
      );
      if (stage === undefined) {
        return [];
      }
      return [stage];
    }),
  };
}

function getJson<Schema extends TSchema>(
  fetchImpl: NwpsFetch,
  url: URL,
  schema: Schema,
): Effect.Effect<Static<Schema>, NwpsError> {
  function fail(reason: NwpsErrorReason): NwpsError {
    return new NwpsError({ url: url.href, reason });
  }
  const body = Effect.tryPromise({
    try: async (signal) => {
      const response = await fetchImpl(url, { signal });
      return { response, text: await response.text() };
    },
    catch: (cause) => fail({ kind: "request", cause }),
  }).pipe(
    Effect.flatMap(({ response, text }) => {
      if (!response.ok) {
        return Effect.fail(fail({ kind: "status", status: response.status }));
      }
      return Effect.succeed(text);
    }),
    Effect.timeoutOrElse({
      duration: REQUEST_TIMEOUT_MS,
      orElse: () =>
        Effect.fail(fail({ kind: "request", cause: new Cause.TimeoutError() })),
    }),
    Effect.retry({
      schedule: Schedule.exponential(RETRY_BASE_DELAY_MS),
      times: MAX_RETRIES,
      while: (error) => isRetryable(error.reason),
    }),
  );
  return body.pipe(
    Effect.flatMap((text) =>
      Effect.try({
        try: (): unknown => JSON.parse(text),
        catch: () =>
          fail({ kind: "schema", detail: "response body is not JSON" }),
      }),
    ),
    Effect.flatMap((json) => {
      if (Value.Check(schema, json)) {
        return Effect.succeed(json);
      }
      const [first] = Value.Errors(schema, json);
      if (first === undefined) {
        return Effect.fail(
          fail({ kind: "schema", detail: "response does not match schema" }),
        );
      }
      return Effect.fail(
        fail({ kind: "schema", detail: `${first.path}: ${first.message}` }),
      );
    }),
  );
}

function makeNwpsClient(
  fetchImpl: NwpsFetch = globalThis.fetch,
  baseUrl: string = NWPS_BASE_URL,
): NwpsClientShape {
  return {
    gauge: (lid): Effect.Effect<RiverGauge, NwpsError> => {
      const gaugeUrl = new URL(`${baseUrl}/gauges/${lid}`);
      const forecastUrl = new URL(`${gaugeUrl.href}/stageflow/forecast`);
      return Effect.all(
        [
          getJson(fetchImpl, gaugeUrl, GaugeResponseSchema),
          getJson(fetchImpl, forecastUrl, ForecastResponseSchema),
        ],
        { concurrency: "unbounded" },
      ).pipe(
        Effect.map(([gauge, forecast]) =>
          toRiverGauge(lid, gaugeUrl, gauge, forecast),
        ),
      );
    },
  };
}

export type {
  FloodCategory,
  NwpsClientShape,
  NwpsErrorReason,
  NwpsFetch,
  NwpsGaugeId,
  RiverGauge,
  StageAt,
};
export { FLOOD_CATEGORIES, makeNwpsClient, NwpsError, NwpsGaugeIdSchema };
