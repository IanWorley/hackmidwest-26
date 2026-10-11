import { DateTime, Effect, Option } from "effect";
import { Elysia, status, t } from "elysia";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
  internalServerErrorResponse,
  type RunRequest,
} from "../../runtime";
import {
  decimalIdParams,
  FACILITIES_PATH,
  FACILITY_NOT_FOUND_MESSAGE,
  facilityNotFoundResponse,
  getFacility,
} from "./facilities";
import { facilityDate } from "./timing";
import { formatDate, toInstant } from "./zoned-time";

const FACILITY_DATE_PATH = `${FACILITIES_PATH}/:id/facility-date`;

/** The facility day a decision made now is about, as `YYYY-MM-DD`. */
const facilityDateResponse = t.Object({ facilityDate: t.String() });

/** The engine's own rule, so the screen and the engine agree that the day rolls over at closing time. */
const facilityDateRequest = Effect.fn("facilityDateRequest")(function* (
  decimalId: string,
) {
  const facility = yield* getFacility(decimalId);
  if (Option.isNone(facility)) {
    return status(HTTP_NOT_FOUND, { message: FACILITY_NOT_FOUND_MESSAGE });
  }
  const now = toInstant(DateTime.toEpochMillis(yield* DateTime.now));
  return { facilityDate: formatDate(facilityDate(facility.value, now)) };
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
