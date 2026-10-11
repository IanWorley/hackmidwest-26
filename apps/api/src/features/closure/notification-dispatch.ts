import { notificationDispatches } from "@hackmidwest/db";
import { Data, DateTime, Effect, Option, Semaphore } from "effect";
import { Database } from "../../runtime";
import type { RecordContent } from "./decision-chain";
import { parseDecimalId } from "./facilities";
import {
  type DecisionFacts,
  type DispatchRow,
  decidedPackage,
  loadDecisionFacts,
  loadFacilityRoster,
  loadRecommendation,
  previewPackage,
} from "./notification-facts";
import {
  ALREADY_DISPATCHED_MESSAGE,
  type DecisionNotificationsView,
  NOT_CURRENT_DECISION_MESSAGE,
  type NotificationConflict,
  PACKAGE_CHANGED_MESSAGE,
  packageHashOf,
  toDecisionNotificationsView,
  toNotificationView,
} from "./notification-view";
import { type DecidedPackage, dispatchTimeline } from "./notifications";
import { decisionChainWrites, type Transaction } from "./record-decision";
import { contentHash } from "./records";
import { localInstant, parseCalendarDate, toIso } from "./zoned-time";

type DecisionNotificationsOutcome =
  | { readonly kind: "found"; readonly view: DecisionNotificationsView }
  | { readonly kind: "decision_not_found" }
  | { readonly kind: "conflict"; readonly conflict: NotificationConflict };

class NotificationStoreError extends Data.TaggedError(
  "NotificationStoreError",
)<{
  readonly operation: "preview" | "read" | "dispatch";
  readonly cause: unknown;
}> {}

const DECISION_NOT_FOUND: DecisionNotificationsOutcome = {
  kind: "decision_not_found",
};

/** The package, with dispatches timed against when the facility's arrival window opens that day. */
function withTimeline(
  pkg: DecidedPackage,
  dispatches: readonly DispatchRow[],
): DecisionNotificationsOutcome {
  const { facility, facilityDate } = pkg.context;
  const arrivalWindowStart = toIso(
    localInstant(
      parseCalendarDate(facilityDate),
      facility.arrivalWindowStart,
      facility.timezone,
    ),
  );
  return {
    kind: "found",
    view: toDecisionNotificationsView(
      pkg,
      dispatchTimeline({ dispatches, arrivalWindowStart }),
    ),
  };
}

function dispatchContent(
  pkg: DecidedPackage,
  recordedAt: string,
): RecordContent<DispatchRow>[] {
  const { decisionId, decisionHash } = pkg.source.decision;
  return pkg.recipients.map(({ employee, delivery }) => ({
    decisionId,
    decisionHash,
    employeeId: employee.id,
    channel: delivery.channel,
    sendBy: delivery.sendBy,
    recordedAt,
  }));
}

/** Already dispatched wins over not current, so retrying a dispatch that landed always reads the same. */
function dispatchRefusal({
  decision,
  currentDecisionId,
  dispatches: [first],
}: DecisionFacts): NotificationConflict | undefined {
  if (first !== undefined) {
    return {
      conflict: "already_dispatched",
      message: ALREADY_DISPATCHED_MESSAGE,
      recordedAt: first.recordedAt,
    };
  }
  if (currentDecisionId !== decision.id) {
    return {
      conflict: "not_current_decision",
      message: NOT_CURRENT_DECISION_MESSAGE,
      currentDecisionId,
    };
  }
  return undefined;
}

async function dispatchInTransaction(
  tx: Transaction,
  decisionId: number,
  reviewedHash: string,
  now: string,
): Promise<DecisionNotificationsOutcome> {
  const facts = await loadDecisionFacts(tx, decisionId, now);
  if (facts === undefined) {
    return DECISION_NOT_FOUND;
  }
  const refusal = dispatchRefusal(facts);
  if (refusal !== undefined) {
    return { kind: "conflict", conflict: refusal };
  }
  const planned = decidedPackage(facts, now);
  if (planned.kind === "conflict") {
    return planned;
  }
  // Rebuilt at dispatch time, the package can differ from the reviewed one: a directive landed, or
  // a notice passed its send-by and moved to the fastest channel. Only the reviewed one goes out.
  const packageHash = packageHashOf(toNotificationView(planned.pkg));
  if (packageHash !== reviewedHash) {
    return {
      kind: "conflict",
      conflict: {
        conflict: "package_changed",
        message: PACKAGE_CHANGED_MESSAGE,
        packageHash,
      },
    };
  }
  const content = dispatchContent(planned.pkg, now);
  // Nobody to tell leaves no row, so the decision still reads as undispatched.
  if (content.length === 0) {
    return withTimeline(planned.pkg, []);
  }
  const recorded = await tx
    .insert(notificationDispatches)
    .values(content.map((row) => ({ ...row, contentHash: contentHash(row) })))
    .returning();
  return withTimeline(planned.pkg, recorded);
}

/** What the recommendation would send if accepted now. Writes nothing; none when no recommendation has the id. */
const previewNotifications = Effect.fn("previewNotifications")(function* (
  decimalId: string,
) {
  const recommendationId = parseDecimalId(decimalId);
  if (Option.isNone(recommendationId)) {
    return Option.none();
  }
  const now = DateTime.formatIso(yield* DateTime.now);
  const db = yield* Database;
  const preview = yield* Effect.tryPromise({
    try: async () => {
      const recommendation = await loadRecommendation(
        db,
        recommendationId.value,
      );
      if (recommendation === undefined) {
        return;
      }
      const roster = await loadFacilityRoster(db, recommendation.facilityId);
      return previewPackage(recommendation, roster, now);
    },
    catch: (cause) =>
      new NotificationStoreError({ operation: "preview", cause }),
  });
  return Option.map(Option.fromNullishOr(preview), toNotificationView);
});

const decisionNotifications = Effect.fn("decisionNotifications")(function* (
  decimalId: string,
) {
  const decisionId = parseDecimalId(decimalId);
  if (Option.isNone(decisionId)) {
    return DECISION_NOT_FOUND;
  }
  const now = DateTime.formatIso(yield* DateTime.now);
  const db = yield* Database;
  const facts = yield* Effect.tryPromise({
    try: () => loadDecisionFacts(db, decisionId.value, now),
    catch: (cause) => new NotificationStoreError({ operation: "read", cause }),
  });
  if (facts === undefined) {
    return DECISION_NOT_FOUND;
  }
  // A dispatched package is rebuilt as of its dispatch, so its wording matches what was recorded.
  const planned = decidedPackage(facts, facts.dispatches[0]?.recordedAt ?? now);
  if (planned.kind === "conflict") {
    return planned;
  }
  return withTimeline(planned.pkg, facts.dispatches);
});

/**
 * Records one dispatch row per recipient, only when the package is still the one reviewed. The
 * once-only, chain-tip, and package checks share the write transaction with the insert; the unique
 * index on (decision, employee) is the backstop.
 */
const dispatchNotifications = Effect.fn("dispatchNotifications")(function* (
  decimalId: string,
  reviewedHash: string,
) {
  const decisionId = parseDecimalId(decimalId);
  if (Option.isNone(decisionId)) {
    return DECISION_NOT_FOUND;
  }
  const now = DateTime.formatIso(yield* DateTime.now);
  const db = yield* Database;
  return yield* Effect.tryPromise({
    try: () =>
      db.transaction((tx) =>
        dispatchInTransaction(tx, decisionId.value, reviewedHash, now),
      ),
    catch: (cause) =>
      new NotificationStoreError({ operation: "dispatch", cause }),
  }).pipe(Semaphore.withPermit(decisionChainWrites));
});

export type { DecisionNotificationsOutcome };
export { decisionNotifications, dispatchNotifications, previewNotifications };
