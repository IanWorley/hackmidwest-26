import { decisions, facilities, recommendations } from "@hackmidwest/db";
import { and, asc, eq, getTableColumns, inArray, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { createSchemaFactory } from "drizzle-typebox";
import { Cache, Data, DateTime, Effect, Option } from "effect";
import { Elysia, t } from "elysia";
import {
  Database,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_OK,
  internalServerErrorResponse,
  type RunRequest,
} from "../../runtime";
import {
  type CurrentDecisionRow,
  findCurrentDecision,
  SNAPSHOT_FACILITY_DATE,
} from "./current-decision";
import {
  AlertCollectionSchema,
  AqiSchema,
  makeLiveConditionsCache,
} from "./map-live";
import { postureSchema } from "./postures";
import { LIVE_RECOMMENDATION, NEWEST_FIRST } from "./recommendation-mode";
import { type Instant, toInstant } from "./zoned-time";

const MAP_PATH = "/api/map";

const { createSelectSchema } = createSchemaFactory({ typeboxInstance: t });
const decisionColumns = createSelectSchema(decisions).properties;

/**
 * The facility's current decision, as `findCurrentDecision` defines it: the newest decision on a live recommendation for
 * today's facility day. A same-day re-evaluation leaves it in place, so `recommendationId` can name an earlier
 * recommendation than the standing's, and then the standing's own recommendation still awaits a decision.
 * `chosenPosture` is set for accept and override.
 */
const CurrentDecisionSchema = t.Object({
  recommendationId: t.Integer(),
  action: decisionColumns.action,
  chosenPosture: decisionColumns.chosenPosture,
  decidedAt: decisionColumns.decidedAt,
  /** When a deferral promised to decide by; set exactly for `defer`, and always before `decideBy`. */
  recheckAt: decisionColumns.recheckAt,
});

const StandingSchema = t.Union([
  /** No live recommendation for today's facility day: never evaluated, or last evaluated before the rollover. */
  t.Object({ posture: t.Literal("not_evaluated") }),
  t.Object({
    posture: postureSchema,
    recommendationId: t.Integer(),
    decideBy: t.String(),
    /** When the evaluation ran, so a reader can judge how fresh the standing is. */
    asOf: t.String(),
    currentDecision: t.Union([CurrentDecisionSchema, t.Null()]),
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

const NOT_EVALUATED: Standing = { posture: "not_evaluated" };
type CurrentDecision = typeof CurrentDecisionSchema.static;

class MapStorageError extends Data.TaggedError("MapStorageError")<{
  readonly cause: unknown;
}> {}

type Db = typeof Database.Service;
type FacilityStanding = Omit<typeof MapFacilitySchema.static, "aqi">;

/** Only the columns the map shows, so the decision's id and hash stay out of the response. */
function currentDecisionView(
  row: CurrentDecisionRow | null,
): CurrentDecision | null {
  if (row === null) {
    return null;
  }
  const { recommendationId, action, chosenPosture, decidedAt, recheckAt } = row;
  return { recommendationId, action, chosenPosture, decidedAt, recheckAt };
}

type StandingRow = typeof recommendations.$inferSelect & {
  /** `snapshot.output.facilityDate`: the facility day the recommendation was evaluated for. */
  readonly facilityDate: string;
};

/**
 * A recommendation for an earlier facility day no longer stands once the day rolls over, so the facility reads as
 * not evaluated until the next evaluation, the same rule `findCurrentDecision` applies to decisions.
 */
async function standingOf(
  db: Db,
  row: StandingRow,
  now: Instant,
): Promise<Standing> {
  const current = await findCurrentDecision(db, row.facilityId, now);
  if (current === null || current.facilityDate !== row.facilityDate) {
    return NOT_EVALUATED;
  }
  return {
    posture: row.posture,
    recommendationId: row.id,
    decideBy: row.decideBy,
    asOf: row.asOf,
    currentDecision: currentDecisionView(current?.decision ?? null),
  };
}

const candidate = alias(recommendations, "candidate");

/** The candidate row is its facility's current recommendation under the same order `findLatestRecommendation` uses. */
function isCurrentRecommendation(db: Db): SQL {
  return eq(
    candidate.id,
    db
      .select({ id: recommendations.id })
      .from(recommendations)
      .where(
        and(
          eq(recommendations.facilityId, candidate.facilityId),
          LIVE_RECOMMENDATION,
        ),
      )
      .orderBy(...NEWEST_FIRST)
      .limit(1),
  );
}

/**
 * Facilities by name, each with its current live recommendation (latest evaluation time), the one
 * `findLatestRecommendation` returns, and the facility's current decision at `now`. Previews never become a standing,
 * and neither does a recommendation for a facility day that has already rolled over.
 */
async function queryStandings(
  db: Db,
  now: Instant,
): Promise<FacilityStanding[]> {
  const latestIds = db
    .select({ id: candidate.id })
    .from(candidate)
    .where(isCurrentRecommendation(db));
  const [facilityRows, latestRows] = await db.batch([
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
      .select({
        ...getTableColumns(recommendations),
        facilityDate: SNAPSHOT_FACILITY_DATE,
      })
      .from(recommendations)
      .where(inArray(recommendations.id, latestIds)),
  ]);
  const standings = new Map<number, Standing>(
    await Promise.all(
      latestRows.map(
        async (row) =>
          [row.facilityId, await standingOf(db, row, now)] as const,
      ),
    ),
  );
  return facilityRows.map((facility) => ({
    ...facility,
    standing: standings.get(facility.id) ?? NOT_EVALUATED,
  }));
}

const readStandings = Effect.fn("readStandings")(function* () {
  const db = yield* Database;
  const now = toInstant(DateTime.toEpochMillis(yield* DateTime.now));
  return yield* Effect.tryPromise({
    try: () => queryStandings(db, now),
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
