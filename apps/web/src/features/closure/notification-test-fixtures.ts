import type {
  DecisionNotifications,
  NotificationPreview,
} from "./notification-api";

const TIMEZONE = "America/Chicago";

const MESSAGE = {
  subject: "Delayed arrival tomorrow",
  whatsHappening: "Freezing rain overnight.",
  appliesToYou: "You are scheduled on site.",
  whatToDo: "Arrive at 10:00.",
};

const PREVIEW: NotificationPreview = {
  source: { kind: "preview", recommendationId: 7 },
  facilityDate: "2026-01-15",
  posture: { posture: "delayed_arrival", delayMinutes: 120 },
  recipients: [
    {
      employeeId: 11,
      name: "Ada Lovelace",
      status: "delayed_arrival",
      reason: "status_changes",
      channel: "sms",
      sendBy: "2026-01-15T11:30:00.000Z",
      late: false,
      rule: "fastest",
      message: MESSAGE,
    },
    {
      employeeId: 12,
      name: "Grace Hopper",
      status: "delayed_arrival",
      reason: "status_changes",
      channel: "email",
      sendBy: "2026-01-15T04:45:00.000Z",
      late: true,
      rule: "preferred",
      message: MESSAGE,
    },
  ],
  exclusions: [
    {
      kind: "skipped",
      employeeId: 13,
      name: "Alan Turing",
      reason: "already_teleworking",
    },
    { kind: "excused", employeeId: 14, name: "Edsger Dijkstra", reason: "PTO" },
    {
      kind: "unmatched",
      employeeId: null,
      name: "Barbara Liskov",
      reason: "not_in_hr",
    },
  ],
};

const UNDISPATCHED: DecisionNotifications = {
  package: { ...PREVIEW, source: { kind: "decided", decisionId: 21 } },
  dispatches: [],
};

export { PREVIEW, TIMEZONE, UNDISPATCHED };
