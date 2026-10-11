import type { Database as DrizzleDatabase } from "@hackmidwest/db";
import { Clock, Context, Effect, Layer, ManagedRuntime } from "effect";
import { type ElysiaCustomStatusResponse, status, t } from "elysia";
import type { NwpsClientShape } from "./clients/nwps";
import type { NwsClientShape } from "./clients/nws";
import type { OpenMeteoClientShape } from "./clients/open-meteo";

type InternalServerFailure = ElysiaCustomStatusResponse<
  typeof HTTP_INTERNAL_SERVER_ERROR,
  typeof internalServerErrorResponse.static
>;

/** Outbound API clients the process builds once and every request shares. */
interface ApiClients {
  readonly nws: NwsClientShape;
  readonly nwps: NwpsClientShape;
  readonly openMeteo: OpenMeteoClientShape;
}

interface ApiRuntimeOptions {
  /** Replaces the system clock, so tests can pin the time a request records. */
  readonly clock?: Clock.Clock;
}

function apiLayer(db: DrizzleDatabase, clients: ApiClients) {
  return Layer.mergeAll(
    Layer.succeed(Database, db),
    Layer.succeed(NwsClient, clients.nws),
    Layer.succeed(NwpsClient, clients.nwps),
    Layer.succeed(OpenMeteoClient, clients.openMeteo),
  );
}

function withClock(
  services: Layer.Layer<ApiServices>,
  clock: Clock.Clock | undefined,
): Layer.Layer<ApiServices> {
  if (clock === undefined) {
    return services;
  }
  return Layer.merge(services, Layer.succeed(Clock.Clock, clock));
}

export class Database extends Context.Service<Database, DrizzleDatabase>()(
  "@hackmidwest/api/Database",
) {}

export class NwsClient extends Context.Service<NwsClient, NwsClientShape>()(
  "@hackmidwest/api/NwsClient",
) {}

export class NwpsClient extends Context.Service<NwpsClient, NwpsClientShape>()(
  "@hackmidwest/api/NwpsClient",
) {}

export class OpenMeteoClient extends Context.Service<
  OpenMeteoClient,
  OpenMeteoClientShape
>()("@hackmidwest/api/OpenMeteoClient") {}

export const HTTP_OK = 200;
export const HTTP_CREATED = 201;
export const HTTP_NOT_FOUND = 404;
export const HTTP_CONFLICT = 409;
export const HTTP_UNPROCESSABLE_ENTITY = 422;
export const HTTP_INTERNAL_SERVER_ERROR = 500;
export const INTERNAL_ERROR_MESSAGE = "Internal server error";

export const internalServerErrorResponse = t.Object({
  message: t.Literal(INTERNAL_ERROR_MESSAGE),
});

export type ApiServices = Layer.Success<ReturnType<typeof apiLayer>>;

/** Run one complete request program. Any failure or defect is logged and becomes a declared 500. */
export type RunRequest = <A, E>(
  program: Effect.Effect<A, E, ApiServices>,
) => Promise<A | InternalServerFailure>;

export interface ApiRuntime {
  readonly runRequest: RunRequest;
  readonly dispose: () => Promise<void>;
}

export function createApiRuntime(
  db: DrizzleDatabase,
  clients: ApiClients,
  { clock }: ApiRuntimeOptions = {},
): ApiRuntime {
  const runtime = ManagedRuntime.make(withClock(apiLayer(db, clients), clock));
  return {
    runRequest: (program) =>
      runtime.runPromise(
        program.pipe(
          Effect.catchCause((cause) =>
            Effect.logError(cause).pipe(
              Effect.as(
                status(HTTP_INTERNAL_SERVER_ERROR, {
                  message: INTERNAL_ERROR_MESSAGE,
                }),
              ),
            ),
          ),
        ),
      ),
    dispose: () => runtime.dispose(),
  };
}

export type { ApiClients };
