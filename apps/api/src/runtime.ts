import type { Database as DrizzleDatabase } from "@hackmidwest/db";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { type ElysiaCustomStatusResponse, status, t } from "elysia";
import type { AirNowClientShape } from "./clients/airnow";
import type { NwsClientShape } from "./clients/nws";

type InternalServerFailure = ElysiaCustomStatusResponse<
  typeof HTTP_INTERNAL_SERVER_ERROR,
  typeof internalServerErrorResponse.static
>;

/** Outbound API clients the process builds once and every request shares. */
interface ApiClients {
  readonly nws: NwsClientShape;
  readonly airNow: AirNowClientShape;
}

function apiLayer(db: DrizzleDatabase, clients: ApiClients) {
  return Layer.mergeAll(
    Layer.succeed(Database, db),
    Layer.succeed(NwsClient, clients.nws),
    Layer.succeed(AirNowClient, clients.airNow),
  );
}

export class Database extends Context.Service<Database, DrizzleDatabase>()(
  "@hackmidwest/api/Database",
) {}

export class NwsClient extends Context.Service<NwsClient, NwsClientShape>()(
  "@hackmidwest/api/NwsClient",
) {}

export class AirNowClient extends Context.Service<
  AirNowClient,
  AirNowClientShape
>()("@hackmidwest/api/AirNowClient") {}

export const HTTP_OK = 200;
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
): ApiRuntime {
  const runtime = ManagedRuntime.make(apiLayer(db, clients));
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
