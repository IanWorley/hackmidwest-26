import { api } from "../../lib/api";
import type { FormField } from "./decision-form";
import { loadFacility } from "./load-facilities";

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

/** Why a decision was refused as stale, in the screen's terms rather than the wire's. */
type Conflict =
  | "previewRecommendation"
  | "newerRecommendation"
  | "decisionChanged";

type DecideOutcome =
  | { readonly kind: "recorded" }
  | { readonly kind: "invalid"; readonly field: FormField }
  | { readonly kind: "conflict"; readonly conflict: Conflict }
  | { readonly kind: "failed" };

type DirectiveOutcome =
  | { readonly kind: "issued" }
  | { readonly kind: "invalid"; readonly field: FormField }
  | { readonly kind: "superseded" }
  | { readonly kind: "failed" };

/** The API reports a refused field as a JSON Pointer into the body; the forms name their controls. */
const API_FIELD_CONTROLS: ReadonlyMap<string, FormField> = new Map([
  ["/decidedById", "recordedBy"],
  ["/issuedById", "recordedBy"],
  ["/chosenPosture", "posture"],
  ["/recheckAt", "recheckIn"],
  ["/reason", "reasonText"],
  ["/reason/category", "reasonCategory"],
  ["/reason/text", "reasonText"],
  ["/scope", "scope"],
  ["/directive", "directive"],
]);
const POINTER_SEPARATOR = "/";
const TOP_LEVEL_SEGMENTS = 2;

/** A pointer deeper than any control, such as `/scope/buildingId`, falls back to its top-level field. */
function controlFor(property: unknown): FormField {
  if (typeof property !== "string") {
    return "form";
  }
  const topLevel = property
    .split(POINTER_SEPARATOR)
    .slice(0, TOP_LEVEL_SEGMENTS)
    .join(POINTER_SEPARATOR);
  return (
    API_FIELD_CONTROLS.get(property) ??
    API_FIELD_CONTROLS.get(topLevel) ??
    "form"
  );
}

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

/** History is newest first, so the first decision on the shown recommendation is the one a new decision supersedes. */
function currentDecisionOf<Row extends { recommendationId: number }>(
  history: readonly Row[],
  recommendation: { id: number } | null,
): Row | null {
  return (
    history.find(
      (decision) => decision.recommendationId === recommendation?.id,
    ) ?? null
  );
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
  const [latestRecommendation, history, recorders, buildings] =
    await Promise.all([
      loadLatestRecommendation(facility.id, signal),
      loadHistory(facility.id, signal),
      loadRecorders(facility.id, signal),
      loadBuildings(facility.id, signal),
    ]);
  const currentDecision = currentDecisionOf(history, latestRecommendation);
  let directives: Awaited<ReturnType<typeof loadDirectives>> = [];
  if (currentDecision !== null) {
    directives = await loadDirectives(currentDecision.id, signal);
  }
  return {
    facility,
    latestRecommendation,
    history,
    currentDecision,
    recorders,
    buildings,
    directives,
    /** The countdown starts here, so the server render and hydration agree. */
    loadedAt: Date.now(),
  };
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
  if ("conflict" in value) {
    return { kind: "superseded" };
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
export {
  currentDecisionOf,
  decide,
  evaluateFacility,
  issueDirective,
  loadDecisionScreen,
};
