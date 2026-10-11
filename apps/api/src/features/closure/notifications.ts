import type {
  NotificationChannel,
  notificationDispatches,
} from "@hackmidwest/db";
import type { Employee } from "./effective-status";
import {
  type AlertUrgency,
  type Notice,
  type NoticeContext,
  planNotice,
} from "./notification-plan";
import type { ContentHash } from "./records";
import {
  type NotifyLine,
  type ReconcileRosterInput,
  reconcileRoster,
  type SkipLine,
  type UnmatchedLine,
} from "./roster";
import { MS_PER_MINUTE, parseInstant } from "./zoned-time";

interface DecisionRef {
  readonly decisionId: number;
  readonly decisionHash: ContentHash;
}

type PackageSource =
  | { readonly kind: "preview"; readonly recommendationId: number }
  | { readonly kind: "decided"; readonly decision: DecisionRef };

/** One posture and one `now` serve both the roster and the message, so they cannot disagree. */
interface NotificationPackageInput<S extends PackageSource = PackageSource>
  extends ReconcileRosterInput,
    NoticeContext {
  readonly source: S;
}

type Recipient = NotifyLine & Notice;

/** `excused` is a notify line whose effective status is not_working: they are told nothing. */
type Exclusion =
  | { readonly kind: "skipped"; readonly line: SkipLine }
  | { readonly kind: "excused"; readonly line: NotifyLine }
  | { readonly kind: "unmatched"; readonly line: UnmatchedLine };

type PlacedExclusion = Exclude<Exclusion, { readonly kind: "unmatched" }>;

interface NotificationPackage<S extends PackageSource = PackageSource> {
  readonly source: S;
  readonly context: NoticeContext;
  /** Sorted by employee id. */
  readonly recipients: readonly Recipient[];
  /** Skipped and excused employees by id, then unmatched roster entries by entry id. */
  readonly exclusions: readonly Exclusion[];
}

/** Only a decided package can be followed up; a preview has no decision to link to. */
type DecidedPackage = NotificationPackage<
  Extract<PackageSource, { readonly kind: "decided" }>
>;

interface PostureChangeUpdate {
  readonly original: DecisionRef;
  readonly superseding: DecisionRef;
  /** Everyone either package notified, by employee id. */
  readonly notices: readonly Notice[];
}

interface AllClear {
  readonly original: DecisionRef;
  readonly notices: readonly Notice[];
}

type DispatchRow = Pick<
  typeof notificationDispatches.$inferSelect,
  "employeeId" | "channel" | "sendBy" | "recordedAt"
>;

interface DispatchTimelineEntry {
  readonly employeeId: number;
  readonly channel: NotificationChannel;
  readonly plannedAt: string;
  readonly recordedAt: string;
  /** Whole minutes, floored. Negative when recorded after the arrival window opened. */
  readonly minutesBeforeArrivalWindow: number;
  readonly recordedAfterSendBy: boolean;
}

/** The hazard is over, so an all-clear is never urgent; a late one still routes fastest. */
const ALL_CLEAR_URGENCY: AlertUrgency = "Past";

function byEmployeeId(a: Employee, b: Employee): number {
  return a.id - b.id;
}

/** Who is told what, when, and how, for a recommendation (preview) or a decision. Pure; `now` is injected. */
function buildNotificationPackage<S extends PackageSource>(
  input: NotificationPackageInput<S>,
): NotificationPackage<S> {
  const roster = reconcileRoster(input);
  const { facility, facilityDate, posture, hazard, urgency, now } = input;
  const context = { facility, facilityDate, posture, hazard, urgency, now };
  const recipients: Recipient[] = [];
  const placed: PlacedExclusion[] = [];
  for (const line of roster.skip) {
    placed.push({ kind: "skipped", line });
  }
  for (const line of roster.notify) {
    const status = line.status.effective;
    if (status.kind === "not_working") {
      placed.push({ kind: "excused", line });
    } else {
      const intent = { kind: "initial", status } as const;
      recipients.push({
        ...line,
        ...planNotice(context, line.employee, intent),
      });
    }
  }
  placed.sort((a, b) => byEmployeeId(a.line.employee, b.line.employee));
  return {
    source: input.source,
    context,
    recipients,
    exclusions: [
      ...placed,
      ...roster.unmatched.map((line) => ({ kind: "unmatched", line }) as const),
    ],
  };
}

function placedLines(pkg: NotificationPackage): (NotifyLine | SkipLine)[] {
  const lines: (NotifyLine | SkipLine)[] = [...pkg.recipients];
  for (const exclusion of pkg.exclusions) {
    if (exclusion.kind !== "unmatched") {
      lines.push(exclusion.line);
    }
  }
  return lines;
}

/**
 * The superseding decision's instructions, framed as replacing the earlier notice, to everyone
 * either package notified. Someone the superseding package does not place at all is told the
 * earlier notice is withdrawn.
 */
function buildPostureChangeUpdate({
  original,
  superseding,
}: {
  readonly original: DecidedPackage;
  readonly superseding: DecidedPackage;
}): PostureChangeUpdate {
  const current = new Map(
    placedLines(superseding).map((line) => [line.employee.id, line]),
  );
  const audience = new Map(
    [...original.recipients, ...superseding.recipients].map(({ employee }) => [
      employee.id,
      employee,
    ]),
  );
  const notices = [...audience.values()].sort(byEmployeeId).map((employee) => {
    const line = current.get(employee.id);
    if (line === undefined) {
      return planNotice(superseding.context, employee, { kind: "withdrawn" });
    }
    return planNotice(superseding.context, line.employee, {
      kind: "update",
      status: line.status.effective,
    });
  });
  return {
    original: original.source.decision,
    superseding: superseding.source.decision,
    notices,
  };
}

/** "The hazard is over", to everyone the original notified, timed to the commute on `resumesOn`. */
function buildAllClear({
  original,
  resumesOn,
  now,
}: {
  readonly original: DecidedPackage;
  /** `YYYY-MM-DD` on the facility's wall clock. */
  readonly resumesOn: string;
  readonly now: string;
}): AllClear {
  const context: NoticeContext = {
    ...original.context,
    facilityDate: resumesOn,
    urgency: ALL_CLEAR_URGENCY,
    now,
  };
  return {
    original: original.source.decision,
    notices: original.recipients.map(({ employee }) =>
      planNotice(context, employee, { kind: "all_clear", resumesOn }),
    ),
  };
}

/** Planned against recorded time per dispatch, for the decision record. Sorted by employee id. */
function dispatchTimeline({
  dispatches,
  arrivalWindowStart,
}: {
  readonly dispatches: readonly DispatchRow[];
  readonly arrivalWindowStart: string;
}): readonly DispatchTimelineEntry[] {
  const arrival = parseInstant(arrivalWindowStart);
  return [...dispatches]
    .sort((a, b) => a.employeeId - b.employeeId)
    .map(({ employeeId, channel, sendBy, recordedAt }) => {
      const recorded = parseInstant(recordedAt);
      return {
        employeeId,
        channel,
        plannedAt: sendBy,
        recordedAt,
        minutesBeforeArrivalWindow: Math.floor(
          (arrival - recorded) / MS_PER_MINUTE,
        ),
        recordedAfterSendBy: recorded > parseInstant(sendBy),
      };
    });
}

export type {
  AllClear,
  DecidedPackage,
  DecisionRef,
  DispatchTimelineEntry,
  NotificationPackage,
  NotificationPackageInput,
  PackageSource,
  PostureChangeUpdate,
};
export {
  buildAllClear,
  buildNotificationPackage,
  buildPostureChangeUpdate,
  dispatchTimeline,
};
