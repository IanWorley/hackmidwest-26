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
import { CLOSED } from "../../schema-options";
import {
  firstInvalidField,
  rejectUnknownFields,
  type ValidationErrorBody,
  validationErrorResponse,
} from "./decision-body";
import { decimalIdParams } from "./facilities";
import {
  type DecisionNotificationsOutcome,
  decisionNotifications,
  dispatchNotifications,
  previewNotifications,
} from "./notification-dispatch";
import {
  type DecisionNotificationsView,
  decisionNotificationsView,
  notificationConflictResponse,
  notificationPackageView,
} from "./notification-view";

const PREVIEW_PATH = "/api/recommendations/:id/notifications/preview";
const DECISION_NOTIFICATIONS_PATH = "/api/decisions/:id/notifications";
const DISPATCH_PATH = "/api/decisions/:id/dispatch";
const RECOMMENDATION_NOT_FOUND_MESSAGE = "Recommendation not found";
const DECISION_NOT_FOUND_MESSAGE = "Decision not found";

const decisionNotFoundResponse = t.Object({
  message: t.Literal(DECISION_NOT_FOUND_MESSAGE),
});

const previewRoute = {
  params: decimalIdParams,
  response: {
    [HTTP_OK]: notificationPackageView,
    [HTTP_NOT_FOUND]: t.Object({
      message: t.Literal(RECOMMENDATION_NOT_FOUND_MESSAGE),
    }),
    [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
  },
};

const decisionNotificationsRoute = {
  params: decimalIdParams,
  response: {
    [HTTP_OK]: decisionNotificationsView,
    [HTTP_NOT_FOUND]: decisionNotFoundResponse,
    [HTTP_CONFLICT]: notificationConflictResponse,
    [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
  },
};

/** Answers in the shape every body 422 uses, not Elysia's verbose one. */
function describeInvalidDispatch({
  found,
}: {
  readonly found: unknown;
}): ValidationErrorBody {
  return firstInvalidField(dispatchBody, found);
}

/** The hash of the package the manager reviewed, from `GET /api/decisions/:id/notifications`. */
const dispatchBody = t.Object(
  { packageHash: t.String() },
  { ...CLOSED, error: describeInvalidDispatch },
);

const dispatchRoute = {
  params: decimalIdParams,
  body: dispatchBody,
  transform: rejectUnknownFields(dispatchBody),
  response: {
    [HTTP_CREATED]: decisionNotificationsView,
    [HTTP_NOT_FOUND]: decisionNotFoundResponse,
    [HTTP_CONFLICT]: notificationConflictResponse,
    [HTTP_UNPROCESSABLE_ENTITY]: validationErrorResponse,
    [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
  },
};

type FoundStatus = typeof HTTP_OK | typeof HTTP_CREATED;

type NotificationsResponse<S extends FoundStatus> =
  | ElysiaCustomStatusResponse<S, DecisionNotificationsView>
  | ElysiaCustomStatusResponse<
      typeof HTTP_NOT_FOUND,
      typeof decisionNotFoundResponse.static
    >
  | ElysiaCustomStatusResponse<
      typeof HTTP_CONFLICT,
      typeof notificationConflictResponse.static
    >;

function toHttpResponse<S extends FoundStatus>(
  foundStatus: S,
): (outcome: DecisionNotificationsOutcome) => NotificationsResponse<S> {
  return (outcome) => {
    switch (outcome.kind) {
      case "found":
        return status(foundStatus, outcome.view);
      case "decision_not_found":
        return status(HTTP_NOT_FOUND, { message: DECISION_NOT_FOUND_MESSAGE });
      case "conflict":
        return status(HTTP_CONFLICT, outcome.conflict);
      default:
        return outcome satisfies never;
    }
  };
}

function createNotificationsModule(runRequest: RunRequest) {
  return new Elysia({ name: "notifications" })
    .get(
      PREVIEW_PATH,
      ({ params }) =>
        runRequest(
          previewNotifications(params.id).pipe(
            Effect.map(
              Option.getOrElse(() =>
                status(HTTP_NOT_FOUND, {
                  message: RECOMMENDATION_NOT_FOUND_MESSAGE,
                }),
              ),
            ),
          ),
        ),
      previewRoute,
    )
    .get(
      DECISION_NOTIFICATIONS_PATH,
      ({ params }) =>
        runRequest(
          decisionNotifications(params.id).pipe(
            Effect.map(toHttpResponse(HTTP_OK)),
          ),
        ),
      decisionNotificationsRoute,
    )
    .post(
      DISPATCH_PATH,
      ({ params, body }) =>
        runRequest(
          dispatchNotifications(params.id, body.packageHash).pipe(
            Effect.map(toHttpResponse(HTTP_CREATED)),
          ),
        ),
      dispatchRoute,
    );
}

export { createNotificationsModule };
