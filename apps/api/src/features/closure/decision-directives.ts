import {
  DIRECTIVE_KINDS,
  DIRECTIVES_WITH_EFFECTIVE_AT,
  type DirectiveKind,
  formatDirectiveScope,
} from "@hackmidwest/db";
import { Value } from "@sinclair/typebox/value";
import { Clock, Effect, Option } from "effect";
import { Elysia, type ElysiaCustomStatusResponse, status, t } from "elysia";
import {
  HTTP_CREATED,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
  internalServerErrorResponse,
  type RunRequest,
} from "../../runtime";
import { rejectUnknownFields } from "../closed-body";
import { decimalIdParams } from "../decimal-id";
import {
  HTTP_CONFLICT,
  HTTP_UNPROCESSABLE,
  instant,
  reasonSchema,
} from "./decision-request";
import { findChainTip, findDecider } from "./decision-store";
import {
  DECISIONS_PATH,
  decisionNotFound,
  decisionNotFoundResponse,
} from "./decisions";
import {
  DirectiveRecordSchema,
  DirectiveScopeSchema,
  findDecision,
  insertDirective,
  listDirectives,
  scopeInFacility,
} from "./directive-store";
import { parseInstant } from "./zoned-time";

const DIRECTIVES_PATH = `${DECISIONS_PATH}/:id/directives`;
const INVALID_DIRECTIVE_MESSAGE = "Invalid directive";
const DECISION_SUPERSEDED_MESSAGE =
  "This decision was superseded; issue directives on the current one";
const ID_FIELD = "id";
/** The path TypeBox gives the body itself. */
const WHOLE_BODY_FIELD = "";

const directiveRequestSchema = t.Object(
  {
    scope: DirectiveScopeSchema,
    directive: t.UnionEnum(DIRECTIVE_KINDS),
    /** An earlier release time; only a `dismissed` directive takes one. */
    effectiveAt: t.Optional(instant),
    reason: reasonSchema,
    /** A `decision_makers` row; the app records who acted without verifying identity. */
    issuedById: t.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

type DirectiveRequest = typeof directiveRequestSchema.static;

const invalidDirectiveResponse = t.Object({
  message: t.Literal(INVALID_DIRECTIVE_MESSAGE),
  /** Dotted path to the offending field, such as `reason.text` or `scope`. */
  field: t.String(),
});

const decisionSupersededResponse = t.Object({
  conflict: t.Literal("decision_superseded"),
  message: t.Literal(DECISION_SUPERSEDED_MESSAGE),
  latestDecisionId: t.Integer(),
});

function invalidDirective(
  field: string,
): ElysiaCustomStatusResponse<
  typeof HTTP_UNPROCESSABLE,
  typeof invalidDirectiveResponse.static
> {
  return status(HTTP_UNPROCESSABLE, {
    message: INVALID_DIRECTIVE_MESSAGE,
    field,
  });
}

function decisionSuperseded(
  latestDecisionId: number,
): ElysiaCustomStatusResponse<
  typeof HTTP_CONFLICT,
  typeof decisionSupersededResponse.static
> {
  return status(HTTP_CONFLICT, {
    conflict: "decision_superseded",
    message: DECISION_SUPERSEDED_MESSAGE,
    latestDecisionId,
  });
}

function invalidBodyField(body: unknown): string {
  const first = Value.Errors(directiveRequestSchema, body).First();
  return first?.path.slice(1).replaceAll("/", ".") ?? WHOLE_BODY_FIELD;
}

function takesEffectiveAt(directive: DirectiveKind): boolean {
  const kinds: readonly DirectiveKind[] = DIRECTIVES_WITH_EFFECTIVE_AT;
  return kinds.includes(directive);
}

function utcInstantOrNull(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  return new Date(parseInstant(value)).toISOString();
}

const issueRequest = Effect.fn("issueRequest")(function* (
  decimalId: string,
  request: DirectiveRequest,
) {
  const decision = yield* findDecision(decimalId);
  if (Option.isNone(decision)) {
    return decisionNotFound();
  }
  const { recommendationId, facilityId, contentHash } = decision.value;
  const tip = yield* findChainTip(recommendationId);
  if (Option.isSome(tip) && tip.value !== decision.value.id) {
    return decisionSuperseded(tip.value);
  }
  if (
    request.effectiveAt !== undefined &&
    !takesEffectiveAt(request.directive)
  ) {
    return invalidDirective("effectiveAt");
  }
  const issuer = yield* findDecider(request.issuedById);
  if (Option.isNone(issuer)) {
    return invalidDirective("issuedById");
  }
  if (!(yield* scopeInFacility(request.scope, facilityId))) {
    return invalidDirective("scope");
  }
  const record = yield* insertDirective({
    decisionId: decision.value.id,
    decisionHash: contentHash,
    scope: formatDirectiveScope(request.scope),
    directive: request.directive,
    effectiveAt: utcInstantOrNull(request.effectiveAt),
    reasonCategory: request.reason.category,
    reasonText: request.reason.text,
    issuedById: issuer.value.id,
    issuedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
  });
  return status(HTTP_CREATED, record);
});

const listRequest = Effect.fn("listRequest")(function* (decimalId: string) {
  const decision = yield* findDecision(decimalId);
  if (Option.isNone(decision)) {
    return decisionNotFound();
  }
  return yield* listDirectives(decision.value.id);
});

export function createDirectivesModule(runRequest: RunRequest) {
  return new Elysia({ name: "directives" })
    .post(
      DIRECTIVES_PATH,
      ({ params, body }) => runRequest(issueRequest(params.id, body)),
      {
        params: decimalIdParams,
        body: directiveRequestSchema,
        transform: rejectUnknownFields(directiveRequestSchema),
        error: ({ code, error }) => {
          if (code !== "VALIDATION") {
            return;
          }
          if (error.type === "body") {
            return invalidDirective(invalidBodyField(error.value));
          }
          return invalidDirective(ID_FIELD);
        },
        response: {
          [HTTP_CREATED]: DirectiveRecordSchema,
          [HTTP_NOT_FOUND]: decisionNotFoundResponse,
          [HTTP_CONFLICT]: decisionSupersededResponse,
          [HTTP_UNPROCESSABLE]: invalidDirectiveResponse,
          [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
        },
      },
    )
    .get(DIRECTIVES_PATH, ({ params }) => runRequest(listRequest(params.id)), {
      params: decimalIdParams,
      response: {
        [HTTP_OK]: t.Array(DirectiveRecordSchema),
        [HTTP_NOT_FOUND]: decisionNotFoundResponse,
        [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
      },
    });
}
