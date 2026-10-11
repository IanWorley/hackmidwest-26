import {
  type DecisionNotificationsResult,
  type DecisionVerification,
  loadDecisionNotifications,
  loadDecisionVerification,
  loadNotificationPreview,
  loadRecommendation,
  type NotificationPreview,
  type Recommendation,
} from "./notification-api";

/** What the decision screen adds for notices, loaded beside the screen's own data. */
interface NoticeScreen {
  /** Who the latest recommendation would notify; null when there is none or it cannot be built. */
  readonly preview: NotificationPreview | null;
  /** The package for the facility's current decision, as the server reports it, or why it has none. */
  readonly current: {
    readonly decisionId: number;
    readonly result: DecisionNotificationsResult;
  } | null;
  /** The chain check for the newest decision. */
  readonly verification: DecisionVerification | null;
  /** The recommendation the current decision was made on, when a newer one has replaced it. */
  readonly decidedRecommendation: Recommendation | null;
}

/** The screen fields notices depend on: the latest recommendation, the current decision, and the history. */
interface NoticeSources {
  readonly latestRecommendation: { readonly id: number } | null;
  /** The server's current decision for today's facility day; it can outlive a re-evaluation. */
  readonly currentDecision: {
    readonly id: number;
    readonly recommendationId: number;
  } | null;
  /** Newest first; it feeds only the chain check, since its head may be an earlier facility day's. */
  readonly history: readonly {
    readonly id: number;
    readonly recommendationId: number;
  }[];
}

/** The preview only informs the confirmation step, so a failure there must not block the page. */
async function previewOrNull(
  recommendation: NoticeSources["latestRecommendation"],
  signal: AbortSignal,
): Promise<NotificationPreview | null> {
  if (recommendation === null) {
    return null;
  }
  try {
    return await loadNotificationPreview({
      recommendationId: recommendation.id,
      signal,
    });
  } catch {
    return null;
  }
}

function whenPresent<Value, Loaded>(
  value: Value | null | undefined,
  load: (present: Value) => Promise<Loaded>,
): Promise<Loaded | null> {
  if (value === null || value === undefined) {
    return Promise.resolve(null);
  }
  return load(value);
}

async function loadNoticeScreen(
  { latestRecommendation, currentDecision, history }: NoticeSources,
  signal: AbortSignal,
): Promise<NoticeScreen> {
  const [newest] = history;
  // Only a decision in force can be "unchanged", so a lapsed one never triggers the banner.
  let replacedRecommendationId: number | null = null;
  if (
    currentDecision !== null &&
    latestRecommendation !== null &&
    currentDecision.recommendationId !== latestRecommendation.id
  ) {
    replacedRecommendationId = currentDecision.recommendationId;
  }
  const [preview, current, verification, decidedRecommendation] =
    await Promise.all([
      previewOrNull(latestRecommendation, signal),
      whenPresent(currentDecision, async ({ id }) => ({
        decisionId: id,
        result: await loadDecisionNotifications({ decisionId: id, signal }),
      })),
      whenPresent(newest, ({ id }) =>
        loadDecisionVerification({ decisionId: id, signal }),
      ),
      whenPresent(replacedRecommendationId, (recommendationId) =>
        loadRecommendation({ recommendationId, signal }),
      ),
    ]);
  return { preview, current, verification, decidedRecommendation };
}

export type { NoticeScreen };
export { loadNoticeScreen };
