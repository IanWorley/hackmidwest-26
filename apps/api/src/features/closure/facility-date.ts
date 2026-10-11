import { Data, DateTime, Effect, Option } from "effect";
import { Elysia, status, t } from "elysia";
import {
  Database,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
  internalServerErrorResponse,
  type RunRequest,
} from "../../runtime";
import { findCurrentDecision } from "./current-decision";
import {
  decimalIdParams,
  FACILITIES_PATH,
  FACILITY_NOT_FOUND_MESSAGE,
  facilityNotFoundResponse,
  getFacility,
} from "./facilities";
import { facilityDateRollsOverAt } from "./timing";
import { toInstant, toIso } from "./zoned-time";

const FACILITY_DATE_PATH = `${FACILITIES_PATH}/:id/facility-date`;

const facilityDateResponse = t.Object({
  /** `YYYY-MM-DD`: the facility day a decision made now is about. */
  facilityDate: t.String(),
  /** When `facilityDate` next changes, so a screen knows when to reload. */
  rollsOverAt: t.String({ format: "date-time" }),
  /** The decision that stands for `facilityDate`, which directives qualify. */
  currentDecisionId: t.Nullable(t.Integer()),
});

class CurrentDecisionReadError extends Data.TaggedError(
  "CurrentDecisionReadError",
)<{ readonly cause: unknown }> {}

/** The engine's own rules, so the screen, the engine, and the directive route agree on the day and its decision. */
const facilityDateRequest = Effect.fn("facilityDateRequest")(function* (
  decimalId: string,
) {
  const facility = yield* getFacility(decimalId);
  if (Option.isNone(facility)) {
    return status(HTTP_NOT_FOUND, { message: FACILITY_NOT_FOUND_MESSAGE });
  }
  const now = toInstant(DateTime.toEpochMillis(yield* DateTime.now));
  const db = yield* Database;
  const current = yield* Effect.tryPromise({
    try: () => findCurrentDecision(db, facility.value.id, now),
    catch: (cause) => new CurrentDecisionReadError({ cause }),
  });
  if (current === null) {
    return status(HTTP_NOT_FOUND, { message: FACILITY_NOT_FOUND_MESSAGE });
  }
  return {
    facilityDate: current.facilityDate,
    rollsOverAt: toIso(facilityDateRollsOverAt(facility.value, now)),
    currentDecisionId: current.decision?.id ?? null,
  };
});

export function createFacilityDateModule(runRequest: RunRequest) {
  return new Elysia({ name: "facility-date" }).get(
    FACILITY_DATE_PATH,
    ({ params }) => runRequest(facilityDateRequest(params.id)),
    {
      params: decimalIdParams,
      response: {
        [HTTP_OK]: facilityDateResponse,
        [HTTP_NOT_FOUND]: facilityNotFoundResponse,
        [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
      },
    },
  );
}
