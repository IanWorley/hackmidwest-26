import { api } from "../../lib/api";
import { loadFacility } from "./load-facilities";

const HTTP_NOT_FOUND = 404;
const HTTP_UNPROCESSABLE = 422;

type DecideCall = ReturnType<typeof api.api.recommendations>["decisions"];
type DirectivesCall = ReturnType<typeof api.api.decisions>["directives"];

export type DecisionRequest = Parameters<DecideCall["post"]>[0];
export type DirectiveRequest = Parameters<DirectivesCall["post"]>[0];
export type HumanAction = DecisionRequest["action"];

/** What a decision submit can come back as, once Eden's envelope is gone. */
export type DecideOutcome =
  | { readonly kind: "recorded" }
  | { readonly kind: "invalid"; readonly field: string }
  | {
      readonly kind: "conflict";
      readonly conflict: "newer_recommendation" | "decision_changed";
    }
  | { readonly kind: "failed" };

export type DirectiveOutcome =
  | { readonly kind: "issued" }
  | { readonly kind: "invalid"; readonly field: string }
  | { readonly kind: "superseded" }
  | { readonly kind: "failed" };

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

async function loadDecisionMakers(signal: AbortSignal) {
  const result = await api.api["decision-makers"].get({ fetch: { signal } });
  if (result.error !== null) {
    throw new Error("Unable to load decision makers", {
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
export async function loadDecisionScreen({
  facilityId,
  signal,
}: {
  facilityId: string;
  signal: AbortSignal;
}) {
  const facility = await loadFacility({ facilityId, signal });
  const [recommendation, history, decisionMakers, buildings] =
    await Promise.all([
      loadLatestRecommendation(facility.id, signal),
      loadHistory(facility.id, signal),
      loadDecisionMakers(signal),
      loadBuildings(facility.id, signal),
    ]);
  const currentDecision =
    history.find(
      (decision) => decision.recommendationId === recommendation?.id,
    ) ?? null;
  let directives: Awaited<ReturnType<typeof loadDirectives>> = [];
  if (currentDecision !== null) {
    directives = await loadDirectives(currentDecision.id, signal);
  }
  return {
    facility,
    recommendation,
    history,
    currentDecision,
    decisionMakers,
    buildings,
    directives,
    /** The countdown starts here, so the server render and hydration agree. */
    loadedAt: Date.now(),
  };
}

export async function evaluateFacility(facilityId: number): Promise<boolean> {
  const result = await api.api
    .facilities({ id: facilityId })
    .recommendations.post({});
  return result.error === null;
}

export async function decide(
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
    return { kind: "conflict", conflict: value.conflict };
  }
  if (result.error.status === HTTP_UNPROCESSABLE && "field" in value) {
    return { kind: "invalid", field: value.field };
  }
  return { kind: "failed" };
}

export async function issueDirective(
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
  if (result.error.status === HTTP_UNPROCESSABLE && "field" in value) {
    return { kind: "invalid", field: value.field };
  }
  return { kind: "failed" };
}

export type DecisionScreen = Awaited<ReturnType<typeof loadDecisionScreen>>;
export type Recommendation = NonNullable<DecisionScreen["recommendation"]>;
export type Decision = DecisionScreen["history"][number];
export type DecisionMaker = DecisionScreen["decisionMakers"][number];
export type Building = DecisionScreen["buildings"][number];
export type Directive = DecisionScreen["directives"][number];
export type Posture = Recommendation["posture"];
export type ReasonCategory = DirectiveRequest["reason"]["category"];
export type DirectiveKind = DirectiveRequest["directive"];
export type DirectiveScope = DirectiveRequest["scope"];
