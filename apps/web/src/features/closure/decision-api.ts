import { api } from "../../lib/api";
import { controlFor } from "./api-field-controls";
import type { FormField } from "./decision-form";
import { loadFacility, loadFacilityDay } from "./load-facilities";

const HTTP_NOT_FOUND = 404;
const HTTP_UNPROCESSABLE = 422;

type DecideCall = ReturnType<typeof api.api.recommendations>["decisions"];
type DirectivesCall = ReturnType<typeof api.api.decisions>["directives"];

type DecisionRequest = Parameters<DecideCall["post"]>[0];
type DirectiveRequest = Parameters<DirectivesCall["post"]>[0];
type HumanAction = DecisionRequest["action"];
type DecideRefusal = NonNullable<
  Awaited<ReturnType<DecideCall["post"]>>["error"]
>["value"];
type WireConflict = Extract<DecideRefusal, { conflict: string }>["conflict"];
type DirectiveRefusal = NonNullable<
  Awaited<ReturnType<DirectivesCall["post"]>>["error"]
>["value"];
type WireDirectiveConflict = Extract<
  DirectiveRefusal,
  { conflict: string }
>["conflict"];

/** Why a decision was refused as stale, in the screen's terms rather than the wire's. */
type Conflict =
  | "previewRecommendation"
  | "newerRecommendation"
  | "decisionChanged";

type DecideOutcome =
  | { readonly kind: "recorded" }
  | { readonly kind: "invalid"; readonly field: FormField }
  | { readonly kind: "conflict"; readonly conflict: Conflict }
  | { readonly kind: "failed" }
  /** The manager went back from the confirmation step; nothing was sent. */
  | { readonly kind: "cancelled" };

type DirectiveOutcome =
  | { readonly kind: "issued" }
  | { readonly kind: "invalid"; readonly field: FormField }
  | { readonly kind: "superseded" }
  /** Another tab dispatched the decision's notices first; dispatch is once-only, so nothing was saved. */
  | { readonly kind: "dispatched" }
  | { readonly kind: "failed" };

function conflictFor(wire: WireConflict): Conflict {
  switch (wire) {
    case "preview_recommendation":
      return "previewRecommendation";
    case "newer_recommendation":
      return "newerRecommendation";
    case "newer_decision":
      return "decisionChanged";
    default:
      return wire satisfies never;
  }
}

/** Every refusal means the decision on screen no longer takes directives, so the page reloads. */
function directiveConflictFor(wire: WireDirectiveConflict): DirectiveOutcome {
  switch (wire) {
    case "not_current_decision":
    case "no_chosen_posture":
      return { kind: "superseded" };
    case "already_dispatched":
      return { kind: "dispatched" };
    default:
      return wire satisfies never;
  }
}

async function loadLatestRecommendation(
  facilityId: number,
  signal: AbortSignal,
) {
  const result = await api.api
    .facilities({ id: facilityId })
    .recommendations.latest.get({ fetch: { signal } });
  if (result.error === null) {
    return result.data;
  }
  if (result.error.status === HTTP_NOT_FOUND) {
    return null;
  }
  throw new Error("Unable to load the latest recommendation", {
    cause: result.error.value,
  });
}

async function loadHistory(facilityId: number, signal: AbortSignal) {
  const result = await api.api
    .facilities({ id: facilityId })
    .decisions.get({ fetch: { signal } });
  if (result.error !== null) {
    throw new Error("Unable to load the decision history", {
      cause: result.error.value,
    });
  }
  return result.data;
}

async function loadRecorders(facilityId: number, signal: AbortSignal) {
  const result = await api.api
    .facilities({ id: facilityId })
    .recorders.get({ fetch: { signal } });
  if (result.error !== null) {
    throw new Error("Unable to load who may record decisions", {
      cause: result.error.value,
    });
  }
  return result.data;
}

async function loadBuildings(facilityId: number, signal: AbortSignal) {
  const result = await api.api
    .facilities({ id: facilityId })
    .buildings.get({ fetch: { signal } });
  if (result.error !== null) {
    throw new Error("Unable to load the facility's buildings", {
      cause: result.error.value,
    });
  }
  return result.data;
}

async function loadDirectives(decisionId: number, signal: AbortSignal) {
  const result = await api.api
    .decisions({ id: decisionId })
    .directives.get({ fetch: { signal } });
  if (result.error !== null) {
    throw new Error("Unable to load the decision's directives", {
      cause: result.error.value,
    });
  }
  return result.data;
}

/** Everything the decision screen renders, read in one loader so a reload refreshes it together. */
async function loadDecisionScreen({
  facilityId,
  signal,
}: {
  facilityId: string;
  signal: AbortSignal;
}) {
  const facility = await loadFacility({ facilityId, signal });
  const [latestRecommendation, history, recorders, buildings, facilityDay] =
    await Promise.all([
      loadLatestRecommendation(facility.id, signal),
      loadHistory(facility.id, signal),
      loadRecorders(facility.id, signal),
      loadBuildings(facility.id, signal),
      loadFacilityDay(facility.id, signal),
    ]);
  // The server owns the current-decision rule; the history row only supplies what to show.
  const currentDecision =
    history.find(({ id }) => id === facilityDay.currentDecisionId) ?? null;
  // History is newest first, so this is the chain head a new decision on the recommendation must supersede.
  const latestDecisionId = history.find(
    ({ recommendationId }) => recommendationId === latestRecommendation?.id,
  )?.id;
  let directives: Awaited<ReturnType<typeof loadDirectives>> = [];
  if (currentDecision !== null) {
    directives = await loadDirectives(currentDecision.id, signal);
  }
  return {
    facility,
    facilityDate: facilityDay.facilityDate,
    rollsOverAt: facilityDay.rollsOverAt,
    latestRecommendation,
    latestDecisionId,
    history,
    currentDecision,
    recorders,
    buildings,
    directives,
    /** The countdown starts here, so the server render and hydration agree. */
    loadedAt: Date.now(),
  };
}

/**
 * Eden answers a dropped connection with a 503 whose value is the fetch error, and a gateway may
 * answer with text; `in` throws on a string, so only an object body is read for its variant.
 */
function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

async function evaluateFacility(facilityId: number): Promise<boolean> {
  const result = await api.api
    .facilities({ id: facilityId })
    .recommendations.post({});
  return result.error === null;
}

async function decide(
  recommendationId: number,
  request: DecisionRequest,
): Promise<DecideOutcome> {
  const result = await api.api
    .recommendations({ id: recommendationId })
    .decisions.post(request);
  if (result.error === null) {
    return { kind: "recorded" };
  }
  const { value } = result.error;
  if (!isObject(value)) {
    return { kind: "failed" };
  }
  // Eden does not narrow `value` on `status`, so read the variant from its fields.
  if ("conflict" in value) {
    return { kind: "conflict", conflict: conflictFor(value.conflict) };
  }
  if (result.error.status === HTTP_UNPROCESSABLE && "property" in value) {
    return { kind: "invalid", field: controlFor(value.property) };
  }
  return { kind: "failed" };
}

async function issueDirective(
  decisionId: number,
  request: DirectiveRequest,
): Promise<DirectiveOutcome> {
  const result = await api.api
    .decisions({ id: decisionId })
    .directives.post(request);
  if (result.error === null) {
    return { kind: "issued" };
  }
  const { value } = result.error;
  if (!isObject(value)) {
    return { kind: "failed" };
  }
  if ("conflict" in value) {
    return directiveConflictFor(value.conflict);
  }
  if (result.error.status === HTTP_UNPROCESSABLE && "property" in value) {
    return { kind: "invalid", field: controlFor(value.property) };
  }
  return { kind: "failed" };
}

type DecisionScreen = Awaited<ReturnType<typeof loadDecisionScreen>>;
type Recommendation = NonNullable<DecisionScreen["latestRecommendation"]>;
type Decision = DecisionScreen["history"][number];
type Recorder = DecisionScreen["recorders"][number];
type Building = DecisionScreen["buildings"][number];
type Directive = DecisionScreen["directives"][number];
type Posture = Recommendation["posture"];
type ReasonCategory = DirectiveRequest["reason"]["category"];
type DirectiveKind = DirectiveRequest["directive"];
type DirectiveScope = DirectiveRequest["scope"];

export type {
  Building,
  Conflict,
  DecideOutcome,
  Decision,
  DecisionRequest,
  DecisionScreen,
  Directive,
  DirectiveKind,
  DirectiveOutcome,
  DirectiveRequest,
  DirectiveScope,
  HumanAction,
  Posture,
  ReasonCategory,
  Recommendation,
  Recorder,
};
export { decide, evaluateFacility, issueDirective, loadDecisionScreen };
