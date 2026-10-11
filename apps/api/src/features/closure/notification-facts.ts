import {
  buildingRosterEntries,
  buildings,
  type Database as DrizzleDatabase,
  decisionDirectives,
  decisions,
  employeeStatusEvents,
  employees,
  facilities,
  notificationDispatches,
  recommendations,
} from "@hackmidwest/db";
import { asc, eq, getTableColumns } from "drizzle-orm";
import type { StatusEvent } from "./baseline";
import { findCurrentDecision } from "./current-decision";
import { storedHash } from "./decision-chain";
import type { DecisionRow } from "./decision-view";
import { directiveRecordOf } from "./directive-history";
import type { Directive } from "./directives";
import type { Employee, FacilityPosture } from "./effective-status";
import { postureOfDecision } from "./facility-posture";
import { noticeContext } from "./notification-context";
import {
  NO_POSTURE_MESSAGE,
  type NotificationConflict,
  UNTIMED_POSTURE_MESSAGE,
} from "./notification-view";
import {
  buildNotificationPackage,
  type DecidedPackage,
  type NotificationPackage,
  type PackageSource,
} from "./notifications";
import { parseSnapshot, type Snapshot } from "./recommendation-store";
import type { Transaction } from "./record-decision";
import type { RosterEntry } from "./roster";
import { parseInstant } from "./zoned-time";

type FacilityRow = typeof facilities.$inferSelect;
type RecommendationRow = typeof recommendations.$inferSelect;
type DispatchRow = typeof notificationDispatches.$inferSelect;

/** Reads run inside a dispatch's transaction or straight against the database. */
type Reader = DrizzleDatabase | Transaction;

/** Who works at the facility and how its buildings list them. */
interface FacilityRoster {
  readonly facility: FacilityRow;
  readonly employees: readonly Employee[];
  readonly rosterEntries: readonly RosterEntry[];
  readonly statusEvents: readonly StatusEvent[];
}

interface DecisionFacts {
  readonly decision: DecisionRow;
  readonly snapshot: Snapshot;
  readonly roster: FacilityRoster;
  /** The facility's current decision at `now`, which may be another one, or none at all. */
  readonly currentDecisionId: number | null;
  readonly directives: readonly Directive[];
  readonly dispatches: readonly DispatchRow[];
}

type PlannedPackage =
  | { readonly kind: "planned"; readonly pkg: DecidedPackage }
  | { readonly kind: "conflict"; readonly conflict: NotificationConflict };

async function loadFacilityRoster(
  reader: Reader,
  facilityId: number,
): Promise<FacilityRoster> {
  const inFacility = eq(buildings.facilityId, facilityId);
  const [facility] = await reader
    .select()
    .from(facilities)
    .where(eq(facilities.id, facilityId));
  if (facility === undefined) {
    throw new Error(`Facility ${facilityId} is missing`);
  }
  return {
    facility,
    employees: await reader
      .select(getTableColumns(employees))
      .from(employees)
      .innerJoin(buildings, eq(buildings.id, employees.assignedBuildingId))
      .where(inFacility),
    rosterEntries: await reader
      .select(getTableColumns(buildingRosterEntries))
      .from(buildingRosterEntries)
      .innerJoin(buildings, eq(buildings.id, buildingRosterEntries.buildingId))
      .where(inFacility),
    statusEvents: await reader
      .select(getTableColumns(employeeStatusEvents))
      .from(employeeStatusEvents)
      .innerJoin(employees, eq(employees.id, employeeStatusEvents.employeeId))
      .innerJoin(buildings, eq(buildings.id, employees.assignedBuildingId))
      .where(inFacility),
  };
}

async function loadRecommendation(
  reader: Reader,
  recommendationId: number,
): Promise<RecommendationRow | undefined> {
  const [recommendation] = await reader
    .select()
    .from(recommendations)
    .where(eq(recommendations.id, recommendationId));
  return recommendation;
}

/** The decision's first dispatch row; dispatch is once-only, so any row means its notices went out. */
async function findFirstDispatch(
  reader: Reader,
  decisionId: number,
): Promise<DispatchRow | undefined> {
  const [first] = await reader
    .select()
    .from(notificationDispatches)
    .where(eq(notificationDispatches.decisionId, decisionId))
    .orderBy(asc(notificationDispatches.id))
    .limit(1);
  return first;
}

async function loadDecisionFacts(
  reader: Reader,
  decisionId: number,
  now: string,
): Promise<DecisionFacts | undefined> {
  const [decision] = await reader
    .select()
    .from(decisions)
    .where(eq(decisions.id, decisionId));
  if (decision === undefined) {
    return undefined;
  }
  const recommendation = await loadRecommendation(
    reader,
    decision.recommendationId,
  );
  if (recommendation === undefined) {
    throw new Error(`Recommendation ${decision.recommendationId} is missing`);
  }
  const current = await findCurrentDecision(
    reader,
    decision.facilityId,
    parseInstant(now),
  );
  return {
    decision,
    snapshot: parseSnapshot(recommendation.snapshot),
    roster: await loadFacilityRoster(reader, decision.facilityId),
    currentDecisionId: current?.decision?.id ?? null,
    directives: (
      await reader
        .select()
        .from(decisionDirectives)
        .where(eq(decisionDirectives.decisionId, decisionId))
        .orderBy(asc(decisionDirectives.id))
    ).map(directiveRecordOf),
    dispatches: await reader
      .select()
      .from(notificationDispatches)
      .where(eq(notificationDispatches.decisionId, decisionId))
      .orderBy(asc(notificationDispatches.id)),
  };
}

interface PackageParts<S extends PackageSource> {
  readonly source: S;
  readonly roster: FacilityRoster;
  readonly snapshot: Snapshot;
  readonly posture: FacilityPosture;
  readonly directives: readonly Directive[];
  readonly now: string;
}

function packageFor<S extends PackageSource>({
  source,
  roster,
  snapshot,
  posture,
  directives,
  now,
}: PackageParts<S>): NotificationPackage<S> {
  return buildNotificationPackage({
    source,
    ...noticeContext({ facility: roster.facility, snapshot, posture, now }),
    employees: roster.employees,
    rosterEntries: roster.rosterEntries,
    statusEvents: roster.statusEvents,
    directives,
  });
}

/** The package for what the recommendation itself recommends, as if accepted now. */
function previewPackage(
  recommendation: RecommendationRow,
  roster: FacilityRoster,
  now: string,
): NotificationPackage {
  const snapshot = parseSnapshot(recommendation.snapshot);
  const posture = postureOfDecision(
    { action: "accept", chosenPosture: recommendation.posture },
    snapshot.output,
  );
  if (posture.kind !== "decided") {
    throw new Error(
      `Recommendation ${recommendation.id} does not time its own posture`,
    );
  }
  const source = {
    kind: "preview",
    recommendationId: recommendation.id,
  } as const;
  return packageFor({
    source,
    roster,
    snapshot,
    posture: posture.posture,
    directives: [],
    now,
  });
}

function decidedPackage(facts: DecisionFacts, now: string): PlannedPackage {
  const { decision, snapshot, roster } = facts;
  const posture = postureOfDecision(decision, snapshot.output);
  switch (posture.kind) {
    case "undecided":
      return {
        kind: "conflict",
        conflict: {
          conflict: "no_posture",
          message: NO_POSTURE_MESSAGE,
          action: posture.action,
        },
      };
    case "untimed":
      return {
        kind: "conflict",
        conflict: {
          conflict: "untimed_posture",
          message: UNTIMED_POSTURE_MESSAGE,
          posture: posture.posture,
        },
      };
    case "decided": {
      const source = {
        kind: "decided",
        decision: {
          decisionId: decision.id,
          decisionHash: storedHash(decision.contentHash),
        },
      } as const;
      return {
        kind: "planned",
        pkg: packageFor({
          source,
          roster,
          snapshot,
          posture: posture.posture,
          directives: facts.directives,
          now,
        }),
      };
    }
    default:
      return posture satisfies never;
  }
}

export type { DecisionFacts, DispatchRow };
export {
  decidedPackage,
  findFirstDispatch,
  loadDecisionFacts,
  loadFacilityRoster,
  loadRecommendation,
  previewPackage,
};
