import type {
  DecisionVerification,
  NotificationExclusion,
  NotificationRecipient,
} from "./notification-api";

type ChainBreak = DecisionVerification["breaks"][number];
type CodedExclusion = Exclude<NotificationExclusion, { kind: "excused" }>;

export const CHANNEL_LABELS: Record<NotificationRecipient["channel"], string> =
  {
    email: "Email",
    sms: "Text message",
  };

/** Excused people carry their own note, so only the coded reasons need a label. */
export const EXCLUSION_REASON_LABELS: Record<CodedExclusion["reason"], string> =
  {
    no_change: "No change to their day",
    already_teleworking: "Already teleworking",
    not_working: "Not working",
    not_in_hr: "Not in HR records",
    assigned_elsewhere: "Assigned to another facility",
  };

export const CHAIN_RECORD_LABELS: Record<ChainBreak["record"], string> = {
  recommendation: "Recommendation",
  decision: "Decision",
  notification_dispatch: "Notification dispatch",
  directive: "Directive",
};

export const CHAIN_BREAK_REASON_LABELS: Record<ChainBreak["reason"], string> = {
  content_altered: "content altered",
  broken_link: "broken link",
  missing_predecessor: "superseded decision missing",
};
