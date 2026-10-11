import { Elysia, status } from "elysia";
import {
  HTTP_CREATED,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
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
import { decimalIdParams } from "./facilities";

export function createPersonnelModule(runRequest: RunRequest) {
  return new Elysia({ name: "personnel" })
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
