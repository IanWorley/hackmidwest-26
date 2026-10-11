import {
  buildings,
  employees,
  facilities,
  facilityHazards,
  HAZARDS,
  type Hazard,
} from "@hackmidwest/db";
import { asc, eq } from "drizzle-orm";
import { createSchemaFactory } from "drizzle-typebox";
import { Data, Effect, Option } from "effect";
import { Elysia, status, t } from "elysia";
import {
  Database,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
  internalServerErrorResponse,
  type RunRequest,
} from "../../runtime";
import { decimalIdParams, parseDecimalId } from "../decimal-id";

const FACILITIES_PATH = "/api/facilities";
const FACILITY_PATH = `${FACILITIES_PATH}/:id`;
const FACILITY_BUILDINGS_PATH = `${FACILITY_PATH}/buildings`;
const FACILITY_NOT_FOUND_MESSAGE = "Facility not found";

const { createSelectSchema } = createSchemaFactory({ typeboxInstance: t });

const facilityResponse = t.Object({
  ...createSelectSchema(facilities).properties,
  hazards: t.Array(createSelectSchema(facilityHazards).properties.hazard),
});

/** Only what a directive scope picker needs; contact details stay out of this read. */
const buildingResponse = t.Object({
  id: t.Integer(),
  name: t.String(),
  employees: t.Array(t.Object({ id: t.Integer(), name: t.String() })),
});

const facilityNotFoundResponse = t.Object({
  message: t.Literal(FACILITY_NOT_FOUND_MESSAGE),
});

type FacilityRow = typeof facilities.$inferSelect;
type FacilityHazardRow = typeof facilityHazards.$inferSelect;
type Facility = typeof facilityResponse.static;
type Building = typeof buildingResponse.static;

class FacilityStorageError extends Data.TaggedError("FacilityStorageError")<{
  readonly operation: "list" | "get" | "buildings";
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

const getFacility = Effect.fn("getFacility")(function* (decimalId: string) {
  const parsed = parseDecimalId(decimalId);
  if (Option.isNone(parsed)) {
    return Option.none();
  }
  const id = parsed.value;
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

const listBuildings = Effect.fn("listBuildings")(function* (
  facilityId: number,
) {
  const db = yield* Database;
  const [buildingRows, employeeRows] = yield* Effect.tryPromise({
    try: () =>
      db.batch([
        db
          .select({ id: buildings.id, name: buildings.name })
          .from(buildings)
          .where(eq(buildings.facilityId, facilityId))
          .orderBy(asc(buildings.id)),
        db
          .select({
            id: employees.id,
            name: employees.name,
            buildingId: employees.assignedBuildingId,
          })
          .from(employees)
          .innerJoin(buildings, eq(buildings.id, employees.assignedBuildingId))
          .where(eq(buildings.facilityId, facilityId))
          .orderBy(asc(employees.name)),
      ]),
    catch: (cause) =>
      new FacilityStorageError({ operation: "buildings", cause }),
  });
  return buildingRows.map(
    (building): Building => ({
      ...building,
      employees: employeeRows
        .filter(({ buildingId }) => buildingId === building.id)
        .map(({ id, name }) => ({ id, name })),
    }),
  );
});

const buildingsRequest = Effect.fn("buildingsRequest")(function* (
  decimalId: string,
) {
  const facility = yield* getFacility(decimalId);
  if (Option.isNone(facility)) {
    return status(HTTP_NOT_FOUND, { message: FACILITY_NOT_FOUND_MESSAGE });
  }
  return yield* listBuildings(facility.value.id);
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
          getFacility(params.id).pipe(
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
        params: decimalIdParams,
        response: {
          [HTTP_OK]: facilityResponse,
          [HTTP_NOT_FOUND]: facilityNotFoundResponse,
          [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
        },
      },
    )
    .get(
      FACILITY_BUILDINGS_PATH,
      ({ params }) => runRequest(buildingsRequest(params.id)),
      {
        params: decimalIdParams,
        response: {
          [HTTP_OK]: t.Array(buildingResponse),
          [HTTP_NOT_FOUND]: facilityNotFoundResponse,
          [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
        },
      },
    );
}

export type { Facility };
export {
  FACILITIES_PATH,
  FACILITY_NOT_FOUND_MESSAGE,
  facilityNotFoundResponse,
  getFacility,
};
