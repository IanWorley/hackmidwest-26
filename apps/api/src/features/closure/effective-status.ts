import type { EmployeeStatus, employees } from "@hackmidwest/db";
import { type Baseline, baselineStatus, type StatusEvent } from "./baseline";
import {
  type Directive,
  type DirectiveKind,
  winningDirective,
} from "./directives";
import type { Posture } from "./postures";

type Employee = typeof employees.$inferSelect;

/** The only employee facts effective status reads; #42 can pass a full row. */
type EmployeeFacts = Pick<
  Employee,
  "id" | "assignedBuildingId" | "essentialPersonnel" | "teleworkEligible"
>;

type NoDetails = Record<never, never>;

interface PostureDetails {
  readonly normal: NoDetails;
  readonly delayed_arrival: { readonly delayMinutes: number };
  readonly early_dismissal: { readonly releaseAt: string };
  readonly unscheduled_telework: NoDetails;
  readonly full_closure: NoDetails;
}

/** The decided posture with its timing, so an early dismissal without a release time cannot be built. */
type FacilityPosture<P extends Posture = Posture> = {
  [K in P]: { readonly posture: K } & PostureDetails[K];
}[P];

/** What produced an effective status. The UI and #29 format it; nothing here builds prose. */
type Cause =
  | { readonly source: "baseline"; readonly baseline: Baseline }
  | { readonly source: "posture"; readonly posture: Posture }
  | { readonly source: "directive"; readonly directive: Directive };

/** `all_day`: never reports today (full closure, or a dismissal with no time anywhere). */
type Release = "all_day" | { readonly at: string };

type EffectiveStatusBody =
  | { readonly kind: "working_onsite" }
  | { readonly kind: "teleworking" }
  | { readonly kind: "delayed_arrival"; readonly delayMinutes: number }
  | { readonly kind: "report_required" }
  | { readonly kind: "dismissed"; readonly release: Release }
  | { readonly kind: "not_working"; readonly note: string };

type EffectiveStatus = { readonly cause: Cause } & EffectiveStatusBody;
type EffectiveStatusKind = EffectiveStatus["kind"];

interface PersonnelStatus {
  readonly baseline: Baseline;
  readonly effective: EffectiveStatus;
}

interface EffectiveStatusInput {
  readonly employee: EmployeeFacts;
  /** Any superset of this employee's events; others are ignored. */
  readonly statusEvents: readonly StatusEvent[];
  readonly posture: FacilityPosture;
  /** The current decision's directives. Ones issued after `now` are ignored, so a replay matches. */
  readonly directives: readonly Directive[];
  readonly now: string;
}

type Role = "essential" | "teleworkEligible" | "onsiteOnly";

type PostureRule<P extends Posture> = (
  posture: FacilityPosture<P>,
) => EffectiveStatusBody;

const WORKING_ONSITE: EffectiveStatusBody = { kind: "working_onsite" };
const TELEWORKING: EffectiveStatusBody = { kind: "teleworking" };
const REPORT_REQUIRED: EffectiveStatusBody = { kind: "report_required" };
const DISMISSED_ALL_DAY: EffectiveStatusBody = {
  kind: "dismissed",
  release: "all_day",
};

function delayedArrival({
  delayMinutes,
}: FacilityPosture<"delayed_arrival">): EffectiveStatusBody {
  return { kind: "delayed_arrival", delayMinutes };
}

function dismissedAtRelease({
  releaseAt,
}: FacilityPosture<"early_dismissal">): EffectiveStatusBody {
  return { kind: "dismissed", release: { at: releaseAt } };
}

const POSTURE_TABLE: {
  readonly [P in Posture]: Readonly<Record<Role, PostureRule<P>>>;
} = {
  normal: {
    essential: () => WORKING_ONSITE,
    teleworkEligible: () => WORKING_ONSITE,
    onsiteOnly: () => WORKING_ONSITE,
  },
  delayed_arrival: {
    essential: () => REPORT_REQUIRED,
    teleworkEligible: delayedArrival,
    onsiteOnly: delayedArrival,
  },
  early_dismissal: {
    essential: () => REPORT_REQUIRED,
    teleworkEligible: dismissedAtRelease,
    onsiteOnly: dismissedAtRelease,
  },
  // OPM: staff who cannot telework report as usual, so the office stays open for them.
  unscheduled_telework: {
    essential: () => REPORT_REQUIRED,
    teleworkEligible: () => TELEWORKING,
    onsiteOnly: () => WORKING_ONSITE,
  },
  full_closure: {
    essential: () => REPORT_REQUIRED,
    teleworkEligible: () => TELEWORKING,
    onsiteOnly: () => DISMISSED_ALL_DAY,
  },
};

const BASELINE_FOLLOWS_FACILITY: Readonly<Record<EmployeeStatus, boolean>> = {
  working_onsite: true,
  teleworking: false,
  not_working: false,
};

type DirectiveRule = (
  directive: Directive,
  posture: FacilityPosture,
) => EffectiveStatusBody;

const DIRECTIVE_TABLE: Readonly<Record<DirectiveKind, DirectiveRule>> = {
  report: () => REPORT_REQUIRED,
  telework: () => TELEWORKING,
  dismissed: ({ effectiveAt }, posture) => ({
    kind: "dismissed",
    release: directiveRelease(effectiveAt, posture),
  }),
  excused: ({ reasonText }) => ({ kind: "not_working", note: reasonText }),
};

function directiveRelease(
  effectiveAt: string | null,
  posture: FacilityPosture,
): Release {
  if (effectiveAt !== null) {
    return { at: effectiveAt };
  }
  if (posture.posture === "early_dismissal") {
    return { at: posture.releaseAt };
  }
  return "all_day";
}

function roleOf(employee: EmployeeFacts): Role {
  if (employee.essentialPersonnel) {
    return "essential";
  }
  if (employee.teleworkEligible) {
    return "teleworkEligible";
  }
  return "onsiteOnly";
}

function postureBody<P extends Posture>(
  posture: FacilityPosture<P>,
  role: Role,
): EffectiveStatusBody {
  return POSTURE_TABLE[posture.posture][role](posture);
}

function baselineBody(baseline: Baseline): EffectiveStatusBody {
  if (baseline.status === "not_working") {
    return { kind: "not_working", note: baseline.note };
  }
  return { kind: baseline.status };
}

function postureCause(posture: FacilityPosture, baseline: Baseline): Cause {
  if (posture.posture === "normal") {
    return { source: "baseline", baseline };
  }
  return { source: "posture", posture: posture.posture };
}

/** Per-person effective status. Used directly by GET /api/facilities/:id/personnel and by reconcileRoster. */
function effectiveStatus(input: EffectiveStatusInput): PersonnelStatus {
  const { employee, posture } = input;
  const baseline = baselineStatus(employee.id, input.statusEvents, input.now);
  const directive = winningDirective(
    employee,
    BASELINE_FOLLOWS_FACILITY[baseline.status],
    input.directives,
    input.now,
  );
  if (directive !== null) {
    const body = DIRECTIVE_TABLE[directive.directive](directive, posture);
    return {
      baseline,
      effective: { ...body, cause: { source: "directive", directive } },
    };
  }
  if (!BASELINE_FOLLOWS_FACILITY[baseline.status]) {
    return {
      baseline,
      effective: {
        ...baselineBody(baseline),
        cause: { source: "baseline", baseline },
      },
    };
  }
  return {
    baseline,
    effective: {
      ...postureBody(posture, roleOf(employee)),
      cause: postureCause(posture, baseline),
    },
  };
}

export type {
  Cause,
  EffectiveStatus,
  EffectiveStatusInput,
  EffectiveStatusKind,
  Employee,
  EmployeeFacts,
  FacilityPosture,
  PersonnelStatus,
  Release,
};
export { effectiveStatus };
