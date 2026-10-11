import { Effect, Option } from "effect";
import { Elysia, type ElysiaCustomStatusResponse, status, t } from "elysia";
import {
  HTTP_CONFLICT,
  HTTP_CREATED,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
  HTTP_UNPROCESSABLE_ENTITY,
  internalServerErrorResponse,
  type RunRequest,
} from "../../runtime";
import {
  rejectUnknownFields,
  type ValidationErrorBody,
  validationErrorResponse,
} from "./decision-body";
import { describeInvalidDirective, directiveBody } from "./directive-body";
import {
  type DirectiveRecord,
  directiveResponse,
  listDecisionDirectives,
} from "./directive-history";
import { decimalIdParams } from "./facilities";
import {
  type DirectiveOutcome,
  recordDirective,
  supersededDecisionConflict,
} from "./record-directive";

const DIRECTIVES_PATH = "/api/decisions/:id/directives";
const DECISION_NOT_FOUND_MESSAGE = "Decision not found";

const decisionNotFoundResponse = t.Object({
  message: t.Literal(DECISION_NOT_FOUND_MESSAGE),
});

type RecordDirectiveResponse =
  | ElysiaCustomStatusResponse<typeof HTTP_CREATED, DirectiveRecord>
  | ElysiaCustomStatusResponse<
      typeof HTTP_NOT_FOUND,
      typeof decisionNotFoundResponse.static
    >
  | ElysiaCustomStatusResponse<
      typeof HTTP_CONFLICT,
      typeof supersededDecisionConflict.static
    >
  | ElysiaCustomStatusResponse<
      typeof HTTP_UNPROCESSABLE_ENTITY,
      ValidationErrorBody
    >;

function toHttpResponse(outcome: DirectiveOutcome): RecordDirectiveResponse {
  switch (outcome.kind) {
    case "recorded":
      return status(HTTP_CREATED, outcome.directive);
    case "decision_not_found":
      return status(HTTP_NOT_FOUND, { message: DECISION_NOT_FOUND_MESSAGE });
    case "conflict":
      return status(HTTP_CONFLICT, outcome.conflict);
    case "rejected":
      return status(HTTP_UNPROCESSABLE_ENTITY, outcome.rejection);
    default:
      return outcome satisfies never;
  }
}

function createDirectivesModule(runRequest: RunRequest) {
  return new Elysia({ name: "directives" })
    .post(
      DIRECTIVES_PATH,
      ({ params, body }) =>
        runRequest(
          recordDirective(params.id, body).pipe(Effect.map(toHttpResponse)),
        ),
      {
        params: decimalIdParams,
        body: directiveBody,
        transform: rejectUnknownFields(directiveBody),
        // A nested field's own schema has no custom error, so Elysia would answer in its verbose shape.
        error: ({ code, error }) => {
          if (code === "VALIDATION" && error.type === "body") {
            return status(
              HTTP_UNPROCESSABLE_ENTITY,
              describeInvalidDirective(error.value),
            );
          }
        },
        response: {
          [HTTP_CREATED]: directiveResponse,
          [HTTP_NOT_FOUND]: decisionNotFoundResponse,
          [HTTP_CONFLICT]: supersededDecisionConflict,
          [HTTP_UNPROCESSABLE_ENTITY]: validationErrorResponse,
          [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
        },
      },
    )
    .get(
      DIRECTIVES_PATH,
      ({ params }) =>
        runRequest(
          listDecisionDirectives(params.id).pipe(
            Effect.map(
              Option.getOrElse(() =>
                status(HTTP_NOT_FOUND, { message: DECISION_NOT_FOUND_MESSAGE }),
              ),
            ),
          ),
        ),
      {
        params: decimalIdParams,
        response: {
          [HTTP_OK]: t.Array(directiveResponse),
          [HTTP_NOT_FOUND]: decisionNotFoundResponse,
          [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
        },
      },
    );
}

export { createDirectivesModule };
