import {
  facilities,
  facilityHazards,
  HAZARDS,
  type Hazard,
} from "@hackmidwest/db";
import { asc, eq } from "drizzle-orm";
import { createSchemaFactory } from "drizzle-typebox";
import { Data, Effect, Option } from "effect";
import { Elysia, t } from "elysia";
import {
  Database,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
  internalServerErrorResponse,
  type RunRequest,
} from "../../runtime";

const FACILITIES_PATH = "/api/facilities";
const FACILITY_PATH = `${FACILITIES_PATH}/:id`;
const FACILITY_NOT_FOUND_MESSAGE = "Facility not found";
/**
 * Decimal digits only, so `0x1` or `1e0` cannot alias facility 1 the way
 * numeric coercion would. Fifteen digits keeps every match a safe integer.
 */
const FACILITY_ID_PATTERN = "^[1-9][0-9]{0,14}$";

const { createSelectSchema } = createSchemaFactory({ typeboxInstance: t });

const facilityResponse = t.Object({
  ...createSelectSchema(facilities).properties,
  hazards: t.Array(createSelectSchema(facilityHazards).properties.hazard),
});

const facilityParams = t.Object({
  id: t.String({ pattern: FACILITY_ID_PATTERN }),
});

const facilityNotFoundResponse = t.Object({
  message: t.Literal(FACILITY_NOT_FOUND_MESSAGE),
});

type FacilityRow = typeof facilities.$inferSelect;
type FacilityHazardRow = typeof facilityHazards.$inferSelect;
type Facility = typeof facilityResponse.static;

class FacilityStorageError extends Data.TaggedError("FacilityStorageError")<{
  readonly operation: "list" | "get";
  readonly cause: unknown;
}> {}

/** Hazards come back in HAZARDS order, whatever order storage returned them in. */
function withHazards(
  rows: readonly FacilityRow[],
  hazardRows: readonly FacilityHazardRow[],
): Facility[] {
  const hazardsByFacility = new Map<number, Set<Hazard>>();
  for (const { facilityId, hazard } of hazardRows) {
    const hazards = hazardsByFacility.get(facilityId) ?? new Set<Hazard>();
    hazards.add(hazard);
    hazardsByFacility.set(facilityId, hazards);
  }
  return rows.map((row) => ({
    ...row,
    hazards: HAZARDS.filter(
      (hazard) => hazardsByFacility.get(row.id)?.has(hazard) ?? false,
    ),
  }));
}

const listFacilities = Effect.fn("listFacilities")(function* () {
  const db = yield* Database;
  const [rows, hazardRows] = yield* Effect.tryPromise({
    try: () =>
      db.batch([
        db.select().from(facilities).orderBy(asc(facilities.name)),
        db.select().from(facilityHazards),
      ]),
    catch: (cause) => new FacilityStorageError({ operation: "list", cause }),
  });
  return withHazards(rows, hazardRows);
});

const getFacility = Effect.fn("getFacility")(function* (id: number) {
  const db = yield* Database;
  const [rows, hazardRows] = yield* Effect.tryPromise({
    try: () =>
      db.batch([
        db.select().from(facilities).where(eq(facilities.id, id)),
        db
          .select()
          .from(facilityHazards)
          .where(eq(facilityHazards.facilityId, id)),
      ]),
    catch: (cause) => new FacilityStorageError({ operation: "get", cause }),
  });
  return Option.fromNullishOr(withHazards(rows, hazardRows)[0]);
});

export function createFacilitiesModule(runRequest: RunRequest) {
  return new Elysia({ name: "facilities" })
    .get(FACILITIES_PATH, () => runRequest(listFacilities()), {
      response: {
        [HTTP_OK]: t.Array(facilityResponse),
        [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
      },
    })
    .get(
      FACILITY_PATH,
      ({ params, status }) =>
        runRequest(
          getFacility(Number(params.id)).pipe(
            Effect.map(
              Option.getOrElse(() =>
                status(HTTP_NOT_FOUND, {
                  message: FACILITY_NOT_FOUND_MESSAGE,
                }),
              ),
            ),
          ),
        ),
      {
        params: facilityParams,
        response: {
          [HTTP_OK]: facilityResponse,
          [HTTP_NOT_FOUND]: facilityNotFoundResponse,
          [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
        },
      },
    );
}

export { FACILITIES_PATH };
