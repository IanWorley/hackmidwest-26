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
import { and, asc, desc, eq, getTableColumns, lte, or } from "drizzle-orm";
import { Data, Effect, Option } from "effect";
import { Database } from "../../runtime";
import type { StatusEvent } from "./baseline";
import { listDirectives } from "./directive-history";
import { parseDecimalId } from "./facilities";
import { postureOfDecision } from "./facility-posture";
import type { CurrentPosture, PersonnelRecords } from "./personnel-view";
import { parseSnapshot } from "./recommendation-store";
import { facilityDate } from "./timing";
import { formatDate, parseInstant } from "./zoned-time";

type DecisionMakerRow = typeof decisionMakers.$inferSelect;
type DecisionRow = typeof decisions.$inferSelect;
type NewestDecision = Pick<
  DecisionRow,
  "id" | "recommendationId" | "action" | "chosenPosture" | "decidedAt"
> & { readonly snapshot: unknown };

class PersonnelStorageError extends Data.TaggedError("PersonnelStorageError")<{
  readonly cause: unknown;
}> {}

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

/**
 * Ids only grow, so the highest id is the facility's newest decision. A decision recorded after
 * `now` is left for the next read, so the response never applies a decision later than its asOf.
 */
function newestDecisionOf(
  db: DrizzleDatabase,
  facilityId: number,
  now: string,
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
    .where(
      and(eq(decisions.facilityId, facilityId), lte(decisions.decidedAt, now)),
    )
    .orderBy(desc(decisions.id))
    .limit(1);
}

const readFacility = Effect.fn("readFacility")(function* (
  facilityId: number,
  now: string,
) {
  const db = yield* Database;
  return yield* Effect.tryPromise({
    try: () =>
      Promise.all([
        db
          .select({
            timezone: facilities.timezone,
            closesAt: facilities.closesAt,
          })
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
        newestDecisionOf(db, facilityId, now),
      ]),
    catch: (cause) => new PersonnelStorageError({ cause }),
  });
});

/**
 * Everything the personnel view needs at `now`, or none for an unknown facility. The newest
 * decision applies only when its recommendation is about the facility day `now` falls in, so
 * tonight's decision for tomorrow and yesterday's closure both leave today undecided.
 */
const loadPersonnelRecords = Effect.fn("loadPersonnelRecords")(function* (
  decimalId: string,
  now: string,
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
  ] = yield* readFacility(facilityId.value, now);
  const [schedule] = facility;
  if (schedule === undefined) {
    return Option.none<PersonnelRecords>();
  }
  const today = formatDate(facilityDate(schedule, parseInstant(now)));
  const records = {
    facilityId: facilityId.value,
    facilityDate: today,
    buildings: buildingRows,
    recorders,
    employees: employeeRows,
    statusEvents,
  };
  const undecided = Option.some<PersonnelRecords>({
    ...records,
    decision: null,
    posture: { kind: "none" },
    directives: [],
  });
  const [current] = newest;
  if (current === undefined) {
    return undecided;
  }
  const { snapshot, chosenPosture, ...decision } = current;
  const recommendation = parseSnapshot(snapshot).output;
  if (recommendation.facilityDate !== today) {
    return undecided;
  }
  const posture: CurrentPosture = postureOfDecision(
    { action: decision.action, chosenPosture },
    recommendation,
  );
  return Option.some<PersonnelRecords>({
    ...records,
    decision,
    posture,
    directives: yield* listDirectives(decision.id),
  });
});

export { loadPersonnelRecords };
