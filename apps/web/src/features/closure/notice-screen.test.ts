import { afterEach, expect, it, vi } from "vitest";
import { loadNoticeScreen } from "./notice-screen";
import { UNDISPATCHED } from "./notification-test-fixtures";

const notificationApi = vi.hoisted(() => ({
  loadNotificationPreview: vi.fn(),
  loadDecisionNotifications: vi.fn(),
  loadDecisionVerification: vi.fn(),
  loadRecommendation: vi.fn(),
}));
vi.mock("./notification-api", () => notificationApi);

afterEach(() => {
  vi.clearAllMocks();
});

it("loads the notices of the decision still in force after a re-evaluation", async () => {
  notificationApi.loadDecisionNotifications.mockResolvedValue({
    kind: "found",
    view: UNDISPATCHED,
  });
  const { signal } = new AbortController();

  const notices = await loadNoticeScreen(
    {
      latestRecommendation: { id: 2 },
      history: [{ id: 1, recommendationId: 1 }],
    },
    signal,
  );

  expect([
    notices.current,
    notificationApi.loadDecisionNotifications.mock.calls,
  ]).toEqual([
    { decisionId: 1, result: { kind: "found", view: UNDISPATCHED } },
    [[{ decisionId: 1, signal }]],
  ]);
});
