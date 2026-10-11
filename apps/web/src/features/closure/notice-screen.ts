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
  /** The package for the decision in force, the facility's newest, or why it has none. */
  readonly current: {
    readonly decisionId: number;
    readonly result: DecisionNotificationsResult;
  } | null;
  /** The chain check for the newest decision. */
  readonly verification: DecisionVerification | null;
  /** The recommendation the newest decision was made on, when a newer one has replaced it. */
  readonly decidedRecommendation: Recommendation | null;
}

/** The screen fields notices depend on: which recommendation is latest and which decision is newest. */
interface NoticeSources {
  readonly latestRecommendation: { readonly id: number } | null;
  /** Newest first. */
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
  { latestRecommendation, history }: NoticeSources,
  signal: AbortSignal,
): Promise<NoticeScreen> {
  const [newest] = history;
  let replacedRecommendationId: number | null = null;
  if (
    newest !== undefined &&
    latestRecommendation !== null &&
    newest.recommendationId !== latestRecommendation.id
  ) {
    replacedRecommendationId = newest.recommendationId;
  }
  const [preview, current, verification, decidedRecommendation] =
    await Promise.all([
      previewOrNull(latestRecommendation, signal),
      whenPresent(newest, async ({ id }) => ({
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
