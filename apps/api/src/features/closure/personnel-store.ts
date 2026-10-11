import {
  buildings,
  type Database as DrizzleDatabase,
  decisionMakers,
  decisions,
  employeeStatusEvents,
  employees,
  facilities,
  recommendations,
} from "@hackmidwest/db";
import { asc, desc, eq, getTableColumns, or } from "drizzle-orm";
import { Data, Effect, Option } from "effect";
import { Database } from "../../runtime";
import type { StatusEvent } from "./baseline";
import { listDirectives } from "./directive-history";
import { parseDecimalId } from "./facilities";
import { postureOfDecision } from "./facility-posture";
import type { CurrentPosture, PersonnelRecords } from "./personnel-view";
import type { Recommendation } from "./recommendation";

type DecisionMakerRow = typeof decisionMakers.$inferSelect;
type DecisionRow = typeof decisions.$inferSelect;
type NewestDecision = Pick<
  DecisionRow,
  "id" | "recommendationId" | "action" | "chosenPosture" | "decidedAt"
> & { readonly snapshot: unknown };

class PersonnelStorageError extends Data.TaggedError("PersonnelStorageError")<{
  readonly cause: unknown;
}> {}

// PENDING(#72'): replaced by the recommendation store's parseSnapshot(row.snapshot).output.
function recommendationOf(snapshot: unknown): Recommendation {
  return snapshot as Recommendation;
}

function recordersOf(
  db: DrizzleDatabase,
  facilityId: number,
): Promise<DecisionMakerRow[]> {
  return db
    .select(getTableColumns(decisionMakers))
    .from(decisionMakers)
    .innerJoin(
      facilities,
      or(
        eq(facilities.decisionMakerId, decisionMakers.id),
        eq(facilities.backupDecisionMakerId, decisionMakers.id),
      ),
    )
    .where(eq(facilities.id, facilityId))
    .orderBy(
      desc(eq(facilities.decisionMakerId, decisionMakers.id)),
      asc(decisionMakers.id),
    );
}

function statusEventsOf(
  db: DrizzleDatabase,
  facilityId: number,
): Promise<StatusEvent[]> {
  return db
    .select(getTableColumns(employeeStatusEvents))
    .from(employeeStatusEvents)
    .innerJoin(employees, eq(employees.id, employeeStatusEvents.employeeId))
    .innerJoin(buildings, eq(buildings.id, employees.assignedBuildingId))
    .where(eq(buildings.facilityId, facilityId));
}

/** Ids only grow, so the highest id is the facility's newest decision. */
function newestDecisionOf(
  db: DrizzleDatabase,
  facilityId: number,
): Promise<NewestDecision[]> {
  return db
    .select({
      id: decisions.id,
      recommendationId: decisions.recommendationId,
      action: decisions.action,
      chosenPosture: decisions.chosenPosture,
      decidedAt: decisions.decidedAt,
      snapshot: recommendations.snapshot,
    })
    .from(decisions)
    .innerJoin(
      recommendations,
      eq(recommendations.id, decisions.recommendationId),
    )
    .where(eq(decisions.facilityId, facilityId))
    .orderBy(desc(decisions.id))
    .limit(1);
}

const readFacility = Effect.fn("readFacility")(function* (facilityId: number) {
  const db = yield* Database;
  return yield* Effect.tryPromise({
    try: () =>
      Promise.all([
        db
          .select({ id: facilities.id })
          .from(facilities)
          .where(eq(facilities.id, facilityId)),
        db
          .select()
          .from(buildings)
          .where(eq(buildings.facilityId, facilityId))
          .orderBy(asc(buildings.id)),
        recordersOf(db, facilityId),
        db
          .select(getTableColumns(employees))
          .from(employees)
          .innerJoin(buildings, eq(buildings.id, employees.assignedBuildingId))
          .where(eq(buildings.facilityId, facilityId)),
        statusEventsOf(db, facilityId),
        newestDecisionOf(db, facilityId),
      ]),
    catch: (cause) => new PersonnelStorageError({ cause }),
  });
});

/** Everything the personnel view needs, or none for an unknown facility. */
const loadPersonnelRecords = Effect.fn("loadPersonnelRecords")(function* (
  decimalId: string,
) {
  const facilityId = parseDecimalId(decimalId);
  if (Option.isNone(facilityId)) {
    return Option.none<PersonnelRecords>();
  }
  const [
    facility,
    buildingRows,
    recorders,
    employeeRows,
    statusEvents,
    newest,
  ] = yield* readFacility(facilityId.value);
  if (facility.length === 0) {
    return Option.none<PersonnelRecords>();
  }
  const records = {
    facilityId: facilityId.value,
    buildings: buildingRows,
    recorders,
    employees: employeeRows,
    statusEvents,
  };
  const [current] = newest;
  if (current === undefined) {
    return Option.some<PersonnelRecords>({
      ...records,
      decision: null,
      posture: { kind: "none" },
      directives: [],
    });
  }
  const { snapshot, chosenPosture, ...decision } = current;
  const posture: CurrentPosture = postureOfDecision(
    { action: decision.action, chosenPosture },
    recommendationOf(snapshot),
  );
  return Option.some<PersonnelRecords>({
    ...records,
    decision,
    posture,
    directives: yield* listDirectives(decision.id),
  });
});

export { loadPersonnelRecords };
