import { NOTIFICATION_CHANNELS } from "@hackmidwest/db";
import { t } from "elysia";
import type {
  DispatchTimelineEntry,
  NotificationPackage,
  PackageSource,
} from "./notifications";
import { type ContentHash, contentHash, type JsonValue } from "./records";

type Recipient = NotificationPackage["recipients"][number];
type Exclusion = NotificationPackage["exclusions"][number];

// Each list must cover its internal union, or toNotificationView stops compiling.
const STATUS_KINDS = [
  "working_onsite",
  "teleworking",
  "delayed_arrival",
  "report_required",
  "dismissed",
  "not_working",
] as const;
const NOTIFY_REASONS = [
  "status_changes",
  "directive_issued",
  "posture_announcement",
] as const;
const SKIP_REASONS = [
  "no_change",
  "already_teleworking",
  "not_working",
] as const;
const UNMATCHED_REASONS = ["not_in_hr", "assigned_elsewhere"] as const;
const CHANNEL_RULES = ["fastest", "preferred"] as const;

const postureView = t.Union([
  t.Object({
    posture: t.Literal("delayed_arrival"),
    delayMinutes: t.Integer(),
  }),
  t.Object({ posture: t.Literal("early_dismissal"), releaseAt: t.String() }),
  t.Object({
    posture: t.UnionEnum(["normal", "unscheduled_telework", "full_closure"]),
  }),
]);

const recipientView = t.Object({
  employeeId: t.Integer(),
  name: t.String(),
  status: t.UnionEnum(STATUS_KINDS),
  reason: t.UnionEnum(NOTIFY_REASONS),
  channel: t.UnionEnum(NOTIFICATION_CHANNELS),
  sendBy: t.String(),
  late: t.Boolean(),
  rule: t.UnionEnum(CHANNEL_RULES),
  message: t.Object({
    subject: t.String(),
    whatsHappening: t.String(),
    appliesToYou: t.String(),
    whatToDo: t.String(),
  }),
});

const exclusionView = t.Union([
  t.Object({
    kind: t.Literal("skipped"),
    employeeId: t.Integer(),
    name: t.String(),
    reason: t.UnionEnum(SKIP_REASONS),
  }),
  t.Object({
    kind: t.Literal("excused"),
    employeeId: t.Integer(),
    name: t.String(),
    /** Why they are not working, from their status or the directive that excused them. */
    reason: t.String(),
  }),
  t.Object({
    kind: t.Literal("unmatched"),
    /** Names need not be unique and the employee may be unknown, so the entry id tells two apart. */
    rosterEntryId: t.Integer(),
    employeeId: t.Nullable(t.Integer()),
    name: t.String(),
    reason: t.UnionEnum(UNMATCHED_REASONS),
  }),
]);

/** A package as the UI reads it: names and instructions, not the planner's internals. */
const notificationPackageView = t.Object({
  source: t.Union([
    t.Object({ kind: t.Literal("preview"), recommendationId: t.Integer() }),
    t.Object({ kind: t.Literal("decided"), decisionId: t.Integer() }),
  ]),
  facilityDate: t.String(),
  posture: postureView,
  recipients: t.Array(recipientView),
  exclusions: t.Array(exclusionView),
});
type NotificationPackageView = typeof notificationPackageView.static;

const dispatchTimelineView = t.Object({
  employeeId: t.Integer(),
  channel: t.UnionEnum(NOTIFICATION_CHANNELS),
  plannedAt: t.String(),
  recordedAt: t.String(),
  minutesBeforeArrivalWindow: t.Integer(),
  recordedAfterSendBy: t.Boolean(),
});

const decisionNotificationsView = t.Object({
  package: notificationPackageView,
  /** The content hash of `package`. A dispatch sends back the one the manager reviewed. */
  packageHash: t.String(),
  dispatches: t.Array(dispatchTimelineView),
});
type DecisionNotificationsView = typeof decisionNotificationsView.static;

const NO_POSTURE_MESSAGE =
  "This decision sets no posture, so there is nothing to notify";
const UNTIMED_POSTURE_MESSAGE =
  "The recommendation never timed this posture, so there is no delay or release to announce";
const ALREADY_DISPATCHED_MESSAGE = "This decision was already dispatched";
const PACKAGE_CHANGED_MESSAGE =
  "Who is told, or how, changed since this package was shown. Nothing was sent; review it and dispatch again.";
const NOT_CURRENT_DECISION_MESSAGE =
  "Only the facility's current decision can be dispatched";

const notificationConflictResponse = t.Union([
  t.Object({
    conflict: t.Literal("no_posture"),
    message: t.Literal(NO_POSTURE_MESSAGE),
    action: t.UnionEnum(["defer", "no_decision"]),
  }),
  t.Object({
    conflict: t.Literal("untimed_posture"),
    message: t.Literal(UNTIMED_POSTURE_MESSAGE),
    posture: t.UnionEnum(["delayed_arrival", "early_dismissal"]),
  }),
  t.Object({
    conflict: t.Literal("already_dispatched"),
    message: t.Literal(ALREADY_DISPATCHED_MESSAGE),
    recordedAt: t.String(),
  }),
  t.Object({
    conflict: t.Literal("package_changed"),
    message: t.Literal(PACKAGE_CHANGED_MESSAGE),
    /** The package as it would go out now, so the client can tell which one it should show. */
    packageHash: t.String(),
  }),
  t.Object({
    conflict: t.Literal("not_current_decision"),
    message: t.Literal(NOT_CURRENT_DECISION_MESSAGE),
    currentDecisionId: t.Nullable(t.Integer()),
  }),
]);
type NotificationConflict = typeof notificationConflictResponse.static;

function sourceView(source: PackageSource): NotificationPackageView["source"] {
  switch (source.kind) {
    case "preview":
      return source;
    case "decided":
      return { kind: "decided", decisionId: source.decision.decisionId };
    default:
      return source satisfies never;
  }
}

function recipientOf({
  employee,
  status,
  reason,
  delivery,
  message,
}: Recipient): NotificationPackageView["recipients"][number] {
  return {
    employeeId: employee.id,
    name: employee.name,
    status: status.effective.kind,
    reason,
    channel: delivery.channel,
    sendBy: delivery.sendBy,
    late: delivery.late,
    rule: delivery.rule,
    message,
  };
}

function exclusionOf(
  exclusion: Exclusion,
): NotificationPackageView["exclusions"][number] {
  switch (exclusion.kind) {
    case "skipped": {
      const { employee, reason } = exclusion.line;
      return {
        kind: "skipped",
        employeeId: employee.id,
        name: employee.name,
        reason,
      };
    }
    case "excused": {
      const { employee, status } = exclusion.line;
      return {
        kind: "excused",
        employeeId: employee.id,
        name: employee.name,
        reason: excusedReason(status.effective),
      };
    }
    case "unmatched": {
      const { entry, reason } = exclusion.line;
      return {
        kind: "unmatched",
        rosterEntryId: entry.id,
        employeeId: entry.employeeId,
        name: entry.listedName,
        reason,
      };
    }
    default:
      return exclusion satisfies never;
  }
}

function excusedReason(effective: Recipient["status"]["effective"]): string {
  if (effective.kind === "not_working") {
    return effective.note;
  }
  return effective.kind;
}

function toNotificationView(pkg: NotificationPackage): NotificationPackageView {
  return {
    source: sourceView(pkg.source),
    facilityDate: pkg.context.facilityDate,
    posture: pkg.context.posture,
    recipients: pkg.recipients.map(recipientOf),
    exclusions: pkg.exclusions.map(exclusionOf),
  };
}

/** Hashed with the record chain's canonical JSON, so equal packages hash alike whatever their key order. */
function packageHashOf(view: NotificationPackageView): ContentHash {
  const json: JsonValue = JSON.parse(JSON.stringify(view));
  return contentHash(json);
}

function toDecisionNotificationsView(
  pkg: NotificationPackage,
  dispatches: readonly DispatchTimelineEntry[],
): DecisionNotificationsView {
  const view = toNotificationView(pkg);
  return {
    package: view,
    packageHash: packageHashOf(view),
    dispatches: [...dispatches],
  };
}

export type {
  DecisionNotificationsView,
  NotificationConflict,
  NotificationPackageView,
};
export {
  ALREADY_DISPATCHED_MESSAGE,
  decisionNotificationsView,
  NO_POSTURE_MESSAGE,
  NOT_CURRENT_DECISION_MESSAGE,
  notificationConflictResponse,
  notificationPackageView,
  PACKAGE_CHANGED_MESSAGE,
  packageHashOf,
  toDecisionNotificationsView,
  toNotificationView,
  UNTIMED_POSTURE_MESSAGE,
};
