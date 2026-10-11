import { api } from "../../lib/api";

const HTTP_CONFLICT = 409;

type RecommendationCalls = ReturnType<typeof api.api.recommendations>;
type DecisionCalls = ReturnType<typeof api.api.decisions>;
type Response<Call extends (...args: never[]) => Promise<unknown>> = Awaited<
  ReturnType<Call>
>;
type Data<Call extends (...args: never[]) => Promise<{ data: unknown }>> =
  NonNullable<Response<Call>["data"]>;

type NotificationPreview = Data<
  RecommendationCalls["notifications"]["preview"]["get"]
>;
type DecisionNotifications = Data<DecisionCalls["notifications"]["get"]>;
type DecisionVerification = Data<DecisionCalls["verify"]["get"]>;
type Recommendation = Data<RecommendationCalls["get"]>;
type NotificationConflict = Extract<
  NonNullable<Response<DecisionCalls["notifications"]["get"]>["error"]>,
  { status: typeof HTTP_CONFLICT }
>["value"];

type NotificationRecipient = NotificationPreview["recipients"][number];
type NotificationExclusion = NotificationPreview["exclusions"][number];
type NotificationDispatch = DecisionNotifications["dispatches"][number];

/** A decision whose posture cannot be announced answers 409; the UI shows why rather than failing. */
type DecisionNotificationsResult =
  | { readonly kind: "found"; readonly view: DecisionNotifications }
  | { readonly kind: "conflict"; readonly conflict: NotificationConflict };

type DispatchResult =
  | { readonly kind: "dispatched"; readonly view: DecisionNotifications }
  | { readonly kind: "conflict"; readonly conflict: NotificationConflict };

interface Request {
  readonly signal: AbortSignal;
}

async function loadRecommendation({
  recommendationId,
  signal,
}: Request & { recommendationId: number }): Promise<Recommendation> {
  const result = await api.api
    .recommendations({ id: recommendationId })
    .get({ fetch: { signal } });
  if (result.error !== null) {
    throw new Error("Unable to load the recommendation", {
      cause: result.error.value,
    });
  }
  return result.data;
}

async function loadNotificationPreview({
  recommendationId,
  signal,
}: Request & { recommendationId: number }): Promise<NotificationPreview> {
  const result = await api.api
    .recommendations({ id: recommendationId })
    .notifications.preview.get({ fetch: { signal } });
  if (result.error !== null) {
    throw new Error("Unable to load the notification preview", {
      cause: result.error.value,
    });
  }
  return result.data;
}

async function loadDecisionNotifications({
  decisionId,
  signal,
}: Request & { decisionId: number }): Promise<DecisionNotificationsResult> {
  const result = await api.api
    .decisions({ id: decisionId })
    .notifications.get({ fetch: { signal } });
  if (result.error === null) {
    return { kind: "found", view: result.data };
  }
  if (result.error.status === HTTP_CONFLICT) {
    return { kind: "conflict", conflict: result.error.value };
  }
  throw new Error("Unable to load the decision's notifications", {
    cause: result.error.value,
  });
}

/** The decided package as the server would build it now, read on demand rather than by the route loader. */
function refreshDecisionNotifications(
  decisionId: number,
): Promise<DecisionNotificationsResult> {
  return loadDecisionNotifications({
    decisionId,
    signal: new AbortController().signal,
  });
}

async function dispatchDecision(decisionId: number): Promise<DispatchResult> {
  const result = await api.api.decisions({ id: decisionId }).dispatch.post();
  if (result.error === null) {
    return { kind: "dispatched", view: result.data };
  }
  if (result.error.status === HTTP_CONFLICT) {
    return { kind: "conflict", conflict: result.error.value };
  }
  throw new Error("Unable to dispatch the decision's notifications", {
    cause: result.error.value,
  });
}

async function loadDecisionVerification({
  decisionId,
  signal,
}: Request & { decisionId: number }): Promise<DecisionVerification> {
  const result = await api.api
    .decisions({ id: decisionId })
    .verify.get({ fetch: { signal } });
  if (result.error !== null) {
    throw new Error("Unable to verify the decision", {
      cause: result.error.value,
    });
  }
  return result.data;
}

export type {
  DecisionNotifications,
  DecisionNotificationsResult,
  DecisionVerification,
  DispatchResult,
  NotificationConflict,
  NotificationDispatch,
  NotificationExclusion,
  NotificationPreview,
  NotificationRecipient,
  Recommendation,
};
export {
  dispatchDecision,
  loadDecisionNotifications,
  loadDecisionVerification,
  loadNotificationPreview,
  loadRecommendation,
  refreshDecisionNotifications,
};
