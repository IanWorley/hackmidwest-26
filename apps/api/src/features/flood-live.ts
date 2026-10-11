// Temporary: shows the flood signals end to end until the closure evaluate route replaces it.
import { LATITUDE_RANGE, LONGITUDE_RANGE } from "@hackmidwest/db";
import { Effect } from "effect";
import { Elysia, t } from "elysia";
import {
  FLOOD_CATEGORIES,
  type FloodCategory,
  type NwpsGaugeId,
  NwpsGaugeIdSchema,
  type RiverGauge,
} from "../clients/nwps";
import {
  type GeoPoint,
  GeoPointSchema,
  NwsAlertSchema,
} from "../clients/nws-model";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_OK,
  internalServerErrorResponse,
  type RunRequest,
} from "../runtime";
import {
  crossedFloodCutoffs,
  gaugeCrossing,
  pullFloodSignals,
} from "./closure/flood";

const FLOOD_LIVE_PATH = "/api/flood/live";

const floodQuery = t.Object({
  lat: t.Numeric({ minimum: LATITUDE_RANGE.min, maximum: LATITUDE_RANGE.max }),
  lon: t.Numeric({
    minimum: LONGITUDE_RANGE.min,
    maximum: LONGITUDE_RANGE.max,
  }),
  gauge: t.Optional(NwpsGaugeIdSchema),
});

const NullableString = t.Union([t.String(), t.Null()]);
const StageAtSchema = t.Object({ stageFt: t.Number(), validTime: t.String() });
const CrossingSchema = t.Object({ start: t.String(), end: NullableString });

const floodResponse = t.Object({
  point: GeoPointSchema,
  alerts: t.Array(NwsAlertSchema),
  gauge: t.Union([
    t.Object({
      lid: t.String(),
      name: t.String(),
      rawRef: t.String(),
      floodStagesFt: t.Partial(
        t.Object({
          action: t.Number(),
          minor: t.Number(),
          moderate: t.Number(),
          major: t.Number(),
        }),
      ),
      observed: t.Union([StageAtSchema, t.Null()]),
      forecast: t.Array(StageAtSchema),
    }),
    t.Null(),
  ]),
  /** Only the categories the gauge reaches within its forecast; `end: null` means still above at the horizon. */
  crossings: t.Partial(
    t.Object({
      action: CrossingSchema,
      minor: CrossingSchema,
      moderate: CrossingSchema,
      major: CrossingSchema,
    }),
  ),
  crossedCutoffs: t.Object({
    warning: t.Boolean(),
    moderateFlood: t.Boolean(),
    majorFlood: t.Boolean(),
  }),
});

type FloodResponse = typeof floodResponse.static;
type WireCrossing = typeof CrossingSchema.static;

function wireGauge(gauge: RiverGauge | undefined): FloodResponse["gauge"] {
  if (gauge === undefined) {
    return null;
  }
  return {
    ...gauge,
    observed: gauge.observed ?? null,
    forecast: [...gauge.forecast],
  };
}

function wireCrossings(
  gauge: RiverGauge | undefined,
): Partial<Record<FloodCategory, WireCrossing>> {
  const crossings: Partial<Record<FloodCategory, WireCrossing>> = {};
  if (gauge === undefined) {
    return crossings;
  }
  for (const category of FLOOD_CATEGORIES) {
    const crossing = gaugeCrossing(gauge, category);
    if (crossing !== undefined) {
      crossings[category] = {
        start: crossing.start,
        end: crossing.end ?? null,
      };
    }
  }
  return crossings;
}

const floodPull = Effect.fn("floodPull")(function* (
  point: GeoPoint,
  gaugeId: NwpsGaugeId | undefined,
) {
  const signals = yield* pullFloodSignals(point, gaugeId);
  const response: FloodResponse = {
    point,
    alerts: [...signals.alerts],
    gauge: wireGauge(signals.gauge),
    crossings: wireCrossings(signals.gauge),
    crossedCutoffs: crossedFloodCutoffs(signals),
  };
  return response;
});

export function createFloodLiveModule(runRequest: RunRequest) {
  return new Elysia({ name: "flood-live" }).get(
    FLOOD_LIVE_PATH,
    ({ query: { lat, lon, gauge } }) =>
      runRequest(floodPull({ lat, lon }, gauge)),
    {
      query: floodQuery,
      response: {
        [HTTP_OK]: floodResponse,
        [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
      },
    },
  );
}

export { FLOOD_LIVE_PATH };
