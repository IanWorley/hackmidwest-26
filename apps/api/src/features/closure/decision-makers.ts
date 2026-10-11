import { decisionMakers } from "@hackmidwest/db";
import { asc } from "drizzle-orm";
import { Data, Effect } from "effect";
import { Elysia, t } from "elysia";
import {
  Database,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_OK,
  internalServerErrorResponse,
  type RunRequest,
} from "../../runtime";

const DECISION_MAKERS_PATH = "/api/decision-makers";

/** The people a form can record as acting; email stays out of this read. */
const decisionMakerResponse = t.Object({
  id: t.Integer(),
  name: t.String(),
  role: t.String(),
});

class DecisionMakerStorageError extends Data.TaggedError(
  "DecisionMakerStorageError",
)<{ readonly cause: unknown }> {}

const listDecisionMakers = Effect.fn("listDecisionMakers")(function* () {
  const db = yield* Database;
  return yield* Effect.tryPromise({
    try: () =>
      db
        .select({
          id: decisionMakers.id,
          name: decisionMakers.name,
          role: decisionMakers.role,
        })
        .from(decisionMakers)
        .orderBy(asc(decisionMakers.name)),
    catch: (cause) => new DecisionMakerStorageError({ cause }),
  });
});

export function createDecisionMakersModule(runRequest: RunRequest) {
  return new Elysia({ name: "decision-makers" }).get(
    DECISION_MAKERS_PATH,
    () => runRequest(listDecisionMakers()),
    {
      response: {
        [HTTP_OK]: t.Array(decisionMakerResponse),
        [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
      },
    },
  );
}

export { DECISION_MAKERS_PATH };
