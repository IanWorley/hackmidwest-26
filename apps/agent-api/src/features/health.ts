import { Effect } from "effect";
import { Elysia, t } from "elysia";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_OK,
  internalServerErrorResponse,
  type RunRequest,
} from "../runtime";

const HEALTH_PATH = "/health";
const HEALTHY_STATUS = "ok";

const healthResponse = t.Object({ status: t.Literal(HEALTHY_STATUS) });

const checkHealth = Effect.succeed({ status: HEALTHY_STATUS } as const);

export function createHealthModule(runRequest: RunRequest) {
  return new Elysia({ name: "health" }).get(
    HEALTH_PATH,
    () => runRequest(checkHealth),
    {
      response: {
        [HTTP_OK]: healthResponse,
        [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
      },
    },
  );
}

export { HEALTH_PATH, HEALTHY_STATUS };
