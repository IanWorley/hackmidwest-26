import { decisions, facilities, recommendations } from "@hackmidwest/db";
import { asc, inArray, max } from "drizzle-orm";
import { createSchemaFactory } from "drizzle-typebox";
import { Cache, Data, Effect, Option } from "effect";
import { Elysia, t } from "elysia";
import {
  Database,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_OK,
  internalServerErrorResponse,
  type RunRequest,
} from "../../runtime";
import {
  AlertCollectionSchema,
  AqiSchema,
  makeLiveConditionsCache,
} from "./map-live";
import { postureSchema } from "./postures";
import { LIVE_RECOMMENDATION } from "./recommendation-mode";

const MAP_PATH = "/api/map";

const { createSelectSchema } = createSchemaFactory({ typeboxInstance: t });
const decisionColumns = createSelectSchema(decisions).properties;

/** The newest decision on the recommendation, the tip of its chain. `chosenPosture` is set for accept and override. */
const DecisionSchema = t.Object({
  action: decisionColumns.action,
  chosenPosture: decisionColumns.chosenPosture,
  decidedAt: decisionColumns.decidedAt,
});

const StandingSchema = t.Union([
  t.Object({ posture: t.Literal("not_evaluated") }),
  t.Object({
    posture: postureSchema,
    recommendationId: t.Integer(),
    decideBy: t.String(),
    /** When the evaluation ran, so a reader can judge how fresh the standing is. */
    asOf: t.String(),
    decision: t.Union([DecisionSchema, t.Null()]),
  }),
]);

const MapFacilitySchema = t.Object({
  id: t.Integer(),
  name: t.String(),
  lat: t.Number(),
  lon: t.Number(),
  /** Live Open-Meteo US AQI, null where the model has no value for the point. */
  aqi: t.Union([AqiSchema, t.Null()]),
  standing: StandingSchema,
});

const MapResponseSchema = t.Object({
  facilities: t.Array(MapFacilitySchema),
  /** Null when NWS or Open-Meteo could not be reached; every `aqi` is null then too. */
  alerts: t.Union([AlertCollectionSchema, t.Null()]),
});

type Standing = typeof StandingSchema.static;
type Decision = typeof DecisionSchema.static;

class MapStorageError extends Data.TaggedError("MapStorageError")<{
  readonly cause: unknown;
}> {}

type Db = typeof Database.Service;
type FacilityStanding = Omit<typeof MapFacilitySchema.static, "aqi">;

function standingsByFacility(
  latestRows: readonly (typeof recommendations.$inferSelect)[],
  tipRows: readonly (Decision & { readonly recommendationId: number })[],
): Map<number, Standing> {
  const tips = new Map<number, Decision>(
    tipRows.map(({ recommendationId, ...decision }) => [
      recommendationId,
      decision,
    ]),
  );
  return new Map<number, Standing>(
    latestRows.map((row) => [
      row.facilityId,
      {
        posture: row.posture,
        recommendationId: row.id,
        decideBy: row.decideBy,
        asOf: row.asOf,
        decision: tips.get(row.id) ?? null,
      },
    ]),
  );
}

/**
 * Facilities by name, each with its newest live recommendation, the one `findLatestRecommendation`
 * returns and a decision is about, and the newest decision on it. Previews never become a standing.
 */
async function queryStandings(db: Db): Promise<FacilityStanding[]> {
  const latestIds = db
    .select({ id: max(recommendations.id) })
    .from(recommendations)
    .where(LIVE_RECOMMENDATION)
    .groupBy(recommendations.facilityId);
  const tipIds = db
    .select({ id: max(decisions.id) })
    .from(decisions)
    .where(inArray(decisions.recommendationId, latestIds))
    .groupBy(decisions.recommendationId);
  const [facilityRows, latestRows, tipRows] = await db.batch([
    db
      .select({
        id: facilities.id,
        name: facilities.name,
        lat: facilities.latitude,
        lon: facilities.longitude,
      })
      .from(facilities)
      .orderBy(asc(facilities.name)),
    db
      .select()
      .from(recommendations)
      .where(inArray(recommendations.id, latestIds)),
    db
      .select({
        recommendationId: decisions.recommendationId,
        action: decisions.action,
        chosenPosture: decisions.chosenPosture,
        decidedAt: decisions.decidedAt,
      })
      .from(decisions)
      .where(inArray(decisions.id, tipIds)),
  ]);
  const standings = standingsByFacility(latestRows, tipRows);
  return facilityRows.map((facility) => ({
    ...facility,
    standing: standings.get(facility.id) ?? { posture: "not_evaluated" },
  }));
}

const readStandings = Effect.fn("readStandings")(function* () {
  const db = yield* Database;
  return yield* Effect.tryPromise({
    try: () => queryStandings(db),
    catch: (cause) => new MapStorageError({ cause }),
  });
});

export function createMapModule(runRequest: RunRequest) {
  const liveConditionsCache = makeLiveConditionsCache();

  const mapRequest = Effect.fn("mapRequest")(function* () {
    const facilityStandings = yield* readStandings();
    const points = facilityStandings.map(({ lat, lon }) => ({ lat, lon }));
    const live = yield* Cache.get(liveConditionsCache, points);
    if (Option.isNone(live)) {
      return {
        facilities: facilityStandings.map((facility) => ({
          ...facility,
          aqi: null,
        })),
        alerts: null,
      };
    }
    const { alerts, aqi } = live.value;
    return {
      facilities: facilityStandings.map((facility, index) => ({
        ...facility,
        aqi: aqi[index] ?? null,
      })),
      alerts,
    };
  });

  return new Elysia({ name: "map" }).get(
    MAP_PATH,
    () => runRequest(mapRequest()),
    {
      response: {
        [HTTP_OK]: MapResponseSchema,
        [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
      },
    },
  );
}

export { MAP_PATH };
