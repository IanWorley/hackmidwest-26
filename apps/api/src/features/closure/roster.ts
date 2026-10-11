import type { buildingRosterEntries, EmployeeStatus } from "@hackmidwest/db";
import type { StatusEvent } from "./baseline";
import type { Directive } from "./directives";
import {
  type Employee,
  effectiveStatus,
  type FacilityPosture,
  type PersonnelStatus,
} from "./effective-status";

type RosterEntry = typeof buildingRosterEntries.$inferSelect;

/** How the building roster agrees with HR for one employee. */
type RosterMatch =
  | { readonly kind: "matched"; readonly entry: RosterEntry }
  | { readonly kind: "unrostered" }
  | {
      readonly kind: "misfiled";
      readonly entries: readonly [RosterEntry, ...RosterEntry[]];
    };

/**
 * status_changes: the effective status differs from the baseline.
 * posture_announcement: an onsite person's day is unchanged but the facility's is not ("the office stays open").
 */
type NotifyReason = "status_changes" | "posture_announcement";

const SKIP_REASON_BY_BASELINE = {
  working_onsite: "no_change",
  teleworking: "already_teleworking",
  not_working: "not_working",
} as const satisfies Record<EmployeeStatus, string>;
type SkipReason = (typeof SKIP_REASON_BY_BASELINE)[EmployeeStatus];

interface NotifyLine {
  /** Shift, commute, channel, contact, and accessibility needs ride along for #29. */
  readonly employee: Employee;
  readonly status: PersonnelStatus;
  readonly roster: RosterMatch;
  readonly reason: NotifyReason;
}

interface SkipLine {
  readonly employee: Employee;
  readonly status: PersonnelStatus;
  readonly roster: RosterMatch;
  readonly reason: SkipReason;
}

/** A roster entry with no HR employee in this facility; no contact info, so it cannot be messaged. */
interface UnmatchedLine {
  readonly entry: RosterEntry;
  /** not_in_hr: employeeId is null. assigned_elsewhere: HR puts them in another facility. */
  readonly reason: "not_in_hr" | "assigned_elsewhere";
}

interface RosterReconciliation {
  readonly notify: readonly NotifyLine[];
  readonly skip: readonly SkipLine[];
  readonly unmatched: readonly UnmatchedLine[];
}

interface ReconcileRosterInput {
  /** HR employees whose assigned building is in the facility. */
  readonly employees: readonly Employee[];
  /** Roster entries whose building is in the facility. */
  readonly rosterEntries: readonly RosterEntry[];
  readonly statusEvents: readonly StatusEvent[];
  readonly posture: FacilityPosture;
  readonly directives: readonly Directive[];
  readonly now: string;
}

type Inclusion =
  | { readonly notified: true; readonly reason: NotifyReason }
  | { readonly notified: false; readonly reason: SkipReason };

function byId(a: { readonly id: number }, b: { readonly id: number }): number {
  return a.id - b.id;
}

function matchRoster(
  employee: Employee,
  entries: readonly RosterEntry[],
): RosterMatch {
  const [first, ...rest] = entries;
  if (first === undefined) {
    return { kind: "unrostered" };
  }
  const entry = entries.find(
    ({ buildingId }) => buildingId === employee.assignedBuildingId,
  );
  if (entry === undefined) {
    return { kind: "misfiled", entries: [first, ...rest] };
  }
  return { kind: "matched", entry };
}

function inclusionOf(
  { baseline, effective }: PersonnelStatus,
  posture: FacilityPosture,
): Inclusion {
  if (effective.kind !== baseline.status) {
    return { notified: true, reason: "status_changes" };
  }
  if (baseline.status === "working_onsite" && posture.posture !== "normal") {
    return { notified: true, reason: "posture_announcement" };
  }
  return { notified: false, reason: SKIP_REASON_BY_BASELINE[baseline.status] };
}

/**
 * Who's in and why. HR decides who exists and how to reach them; the building
 * roster only annotates, so an unrostered employee is still notified. Output is
 * sorted by employee id, then roster entry id.
 */
function reconcileRoster(input: ReconcileRosterInput): RosterReconciliation {
  const hrIds = new Set(input.employees.map(({ id }) => id));
  const entriesByEmployee = new Map<number, RosterEntry[]>();
  const unmatched: UnmatchedLine[] = [];
  for (const entry of [...input.rosterEntries].sort(byId)) {
    if (entry.employeeId === null) {
      unmatched.push({ entry, reason: "not_in_hr" });
    } else if (hrIds.has(entry.employeeId)) {
      const entries = entriesByEmployee.get(entry.employeeId) ?? [];
      entriesByEmployee.set(entry.employeeId, [...entries, entry]);
    } else {
      unmatched.push({ entry, reason: "assigned_elsewhere" });
    }
  }

  const notifyLines: NotifyLine[] = [];
  const skipLines: SkipLine[] = [];
  for (const employee of [...input.employees].sort(byId)) {
    const status = effectiveStatus({ ...input, employee });
    const roster = matchRoster(
      employee,
      entriesByEmployee.get(employee.id) ?? [],
    );
    const inclusion = inclusionOf(status, input.posture);
    if (inclusion.notified) {
      notifyLines.push({ employee, status, roster, reason: inclusion.reason });
    } else {
      skipLines.push({ employee, status, roster, reason: inclusion.reason });
    }
  }
  return { notify: notifyLines, skip: skipLines, unmatched };
}

export type {
  NotifyLine,
  NotifyReason,
  ReconcileRosterInput,
  RosterEntry,
  RosterMatch,
  RosterReconciliation,
  SkipLine,
  SkipReason,
  UnmatchedLine,
};
export { reconcileRoster };
