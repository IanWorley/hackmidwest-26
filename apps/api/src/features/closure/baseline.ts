import type { EmployeeStatus, employeeStatusEvents } from "@hackmidwest/db";

type StatusEvent = typeof employeeStatusEvents.$inferSelect;

type Baseline =
  | {
      readonly status: Exclude<EmployeeStatus, "not_working">;
      /** Null when no event is effective yet: the working_onsite default. */
      readonly event: StatusEvent | null;
    }
  | {
      readonly status: "not_working";
      readonly note: string;
      readonly event: StatusEvent;
    };

function compareEvents(a: StatusEvent, b: StatusEvent): number {
  return (
    Date.parse(a.effectiveFrom) - Date.parse(b.effectiveFrom) ||
    Date.parse(a.reportedAt) - Date.parse(b.reportedAt) ||
    a.id - b.id
  );
}

/**
 * Baseline per #42: the latest event with effectiveFrom <= now, ties broken by
 * the later reportedAt (a correction) and then the higher id. Defaults to working_onsite.
 */
function baselineStatus(
  employeeId: number,
  statusEvents: readonly StatusEvent[],
  now: string,
): Baseline {
  const nowMs = Date.parse(now);
  let latest: StatusEvent | null = null;
  for (const event of statusEvents) {
    if (
      event.employeeId === employeeId &&
      Date.parse(event.effectiveFrom) <= nowMs &&
      (latest === null || compareEvents(event, latest) > 0)
    ) {
      latest = event;
    }
  }
  if (latest === null) {
    return { status: "working_onsite", event: null };
  }
  if (latest.status !== "not_working") {
    return { status: latest.status, event: latest };
  }
  if (latest.note === null) {
    throw new Error(`Status event ${latest.id} is not_working without a note`);
  }
  return { status: "not_working", note: latest.note, event: latest };
}

export type { Baseline, StatusEvent };
export { baselineStatus };
