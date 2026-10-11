import { type Treaty, treaty } from "@elysiajs/eden";
import type { App } from "@hackmidwest/api/contract";
import { Value } from "@sinclair/typebox/value";
import { Data, Effect } from "effect";
import { HTTP_NOT_FOUND, notFoundResponse } from "./runtime";

const EMPTY_BODY = "The API answered success with no body";

type EdenClient = Treaty.Create<App>;
type RecommendationRoutes = ReturnType<EdenClient["api"]["recommendations"]>;

type RecommendationRecord = Treaty.Data<RecommendationRoutes["get"]>;
type NotificationPackage = Treaty.Data<
  RecommendationRoutes["notifications"]["preview"]["get"]
>;
type Task = Treaty.Data<EdenClient["api"]["tasks"]["get"]>[number];

/** The API answered 404. `message` is its body, which callers pass through unchanged. */
class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly message: string;
}> {}

class ApiError extends Data.TaggedError("ApiError")<{
  readonly cause: unknown;
}> {}

/**
 * The only closure routes the agent API may call. Recording a decision and dispatching notifications
 * belong to a human on the decision screen, so this port has no method for either.
 */
interface ClosureApiClient {
  readonly evaluate: (
    decimalFacilityId: string,
  ) => Effect.Effect<RecommendationRecord, NotFoundError | ApiError>;
  /** Takes an id the API just returned, so a 404 here is a failure like any other. */
  readonly previewNotifications: (
    recommendationId: number,
  ) => Effect.Effect<NotificationPackage, ApiError>;
  readonly readRecommendation: (
    decimalRecommendationId: string,
  ) => Effect.Effect<RecommendationRecord, NotFoundError | ApiError>;
}

interface TasksApiClient {
  readonly listTasks: () => Effect.Effect<readonly Task[], ApiError>;
}

interface EdenResult<D, E> {
  readonly data: D | null;
  readonly error: E | null;
}

function call<D, E extends { readonly value: unknown }, F>(
  send: (signal: AbortSignal) => Promise<EdenResult<D, E>>,
  toError: (error: E) => F,
): Effect.Effect<D, ApiError | F> {
  return Effect.tryPromise({
    try: send,
    catch: (cause) => new ApiError({ cause }),
  }).pipe(
    Effect.flatMap(({ data, error }): Effect.Effect<D, ApiError | F> => {
      if (error !== null) {
        return Effect.fail(toError(error));
      }
      if (data === null) {
        return Effect.fail(new ApiError({ cause: EMPTY_BODY }));
      }
      return Effect.succeed(data);
    }),
  );
}

function toApiError({ value }: { readonly value: unknown }): ApiError {
  return new ApiError({ cause: value });
}

function toFindableError({
  status,
  value,
}: {
  readonly status: unknown;
  readonly value: unknown;
}): NotFoundError | ApiError {
  if (status === HTTP_NOT_FOUND && Value.Check(notFoundResponse, value)) {
    return new NotFoundError(value);
  }
  return new ApiError({ cause: value });
}

/** The one place that holds the Eden client. Features get only these narrow ports. */
function createApiClients(baseUrl: string): {
  readonly closureApi: ClosureApiClient;
  readonly tasksApi: TasksApiClient;
} {
  // The contract types dates as strings. Eden would otherwise turn any date-like string into a Date,
  // which re-serializes a date-only "2026-01-14" as a UTC instant.
  const { api } = treaty<App>(baseUrl, { parseDate: false });
  return {
    closureApi: {
      evaluate: (decimalFacilityId) =>
        call(
          (signal) =>
            api
              .facilities({ id: decimalFacilityId })
              .recommendations.post(undefined, { fetch: { signal } }),
          toFindableError,
        ),
      previewNotifications: (recommendationId) =>
        call(
          (signal) =>
            api
              .recommendations({ id: String(recommendationId) })
              .notifications.preview.get({ fetch: { signal } }),
          toApiError,
        ),
      readRecommendation: (decimalRecommendationId) =>
        call(
          (signal) =>
            api
              .recommendations({ id: decimalRecommendationId })
              .get({ fetch: { signal } }),
          toFindableError,
        ),
    },
    tasksApi: {
      listTasks: () =>
        call((signal) => api.tasks.get({ fetch: { signal } }), toApiError),
    },
  };
}

export type {
  ClosureApiClient,
  NotificationPackage,
  RecommendationRecord,
  TasksApiClient,
};
export { ApiError, createApiClients, NotFoundError };
