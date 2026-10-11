import { DateTime, Effect, Option } from "effect";
import { Elysia, status } from "elysia";
import {
  HTTP_CREATED,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
  HTTP_UNPROCESSABLE_ENTITY,
  internalServerErrorResponse,
  type RunRequest,
} from "../../runtime";
import {
  firstInvalidField,
  rejectUnknownFields,
  validationErrorResponse,
} from "./decision-body";
import {
  EMPLOYEE_STATUS_PATH,
  employeeNotFoundResponse,
  recordStatusEvent,
  statusEventBody,
  statusEventResponse,
} from "./employee-status";
import {
  decimalIdParams,
  FACILITIES_PATH,
  FACILITY_NOT_FOUND_MESSAGE,
  facilityNotFoundResponse,
} from "./facilities";
import { personnelResponse } from "./personnel-schema";
import { loadPersonnelRecords } from "./personnel-store";
import { personnelView } from "./personnel-view";

const FACILITY_PERSONNEL_PATH = `${FACILITIES_PATH}/:id/personnel`;

const facilityPersonnel = Effect.fn("facilityPersonnel")(function* (
  decimalId: string,
) {
  const records = yield* loadPersonnelRecords(decimalId);
  const now = DateTime.formatIso(yield* DateTime.now);
  return Option.match(records, {
    onNone: () =>
      status(HTTP_NOT_FOUND, { message: FACILITY_NOT_FOUND_MESSAGE }),
    onSome: (found) => personnelView(found, now),
  });
});

export function createPersonnelModule(runRequest: RunRequest) {
  return new Elysia({ name: "personnel" })
    .get(
      FACILITY_PERSONNEL_PATH,
      ({ params }) => runRequest(facilityPersonnel(params.id)),
      {
        params: decimalIdParams,
        response: {
          [HTTP_OK]: personnelResponse,
          [HTTP_NOT_FOUND]: facilityNotFoundResponse,
          [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
        },
      },
    )
    .post(
      EMPLOYEE_STATUS_PATH,
      ({ params, body }) => runRequest(recordStatusEvent(params.id, body)),
      {
        params: decimalIdParams,
        body: statusEventBody,
        transform: rejectUnknownFields(statusEventBody),
        error: ({ code, error }) => {
          if (code === "VALIDATION" && error.type === "body") {
            return status(
              HTTP_UNPROCESSABLE_ENTITY,
              firstInvalidField(statusEventBody, error.value),
            );
          }
        },
        response: {
          [HTTP_CREATED]: statusEventResponse,
          [HTTP_NOT_FOUND]: employeeNotFoundResponse,
          [HTTP_UNPROCESSABLE_ENTITY]: validationErrorResponse,
          [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
        },
      },
    );
}
