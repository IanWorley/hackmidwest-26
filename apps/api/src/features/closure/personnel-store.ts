import {
  buildings,
  type Database as DrizzleDatabase,
  decisionMakers,
  employeeStatusEvents,
  employees,
  facilities,
  recommendations,
} from "@hackmidwest/db";
import { asc, desc, eq, getTableColumns, or } from "drizzle-orm";
import { Data, Effect, Option } from "effect";
import { Database } from "../../runtime";
import type { StatusEvent } from "./baseline";
import { findCurrentDecision } from "./current-decision";
import { listDirectives } from "./directive-history";
import { parseDecimalId } from "./facilities";
import { postureOfDecision } from "./facility-posture";
import type { CurrentPosture, PersonnelRecords } from "./personnel-view";
import { parseSnapshot } from "./recommendation-store";
import { parseInstant } from "./zoned-time";

type DecisionMakerRow = typeof decisionMakers.$inferSelect;

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

const readFacility = Effect.fn("readFacility")(function* (
  facilityId: number,
  now: string,
) {
  const db = yield* Database;
  return yield* Effect.tryPromise({
    try: () =>
      Promise.all([
        findCurrentDecision(db, facilityId, parseInstant(now)),
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
      ]),
    catch: (cause) => new PersonnelStorageError({ cause }),
  });
});

/** The stored snapshot of the recommendation a decision answered. */
const snapshotOf = Effect.fn("snapshotOf")(function* (
  recommendationId: number,
) {
  const db = yield* Database;
  const [row] = yield* Effect.tryPromise({
    try: () =>
      db
        .select({ snapshot: recommendations.snapshot })
        .from(recommendations)
        .where(eq(recommendations.id, recommendationId)),
    catch: (cause) => new PersonnelStorageError({ cause }),
  });
  if (row === undefined) {
    return yield* Effect.die(
      `Decision references missing recommendation ${recommendationId}`,
    );
  }
  return parseSnapshot(row.snapshot).output;
});

/**
 * Everything the personnel view needs at `now`, or none for an unknown facility. The decision
 * that applies is `findCurrentDecision`'s, the one definition the decision screen and directives
 * share: the newest live decision about the facility day `now` falls in, recorded by `now`.
 */
const loadPersonnelRecords = Effect.fn("loadPersonnelRecords")(function* (
  decimalId: string,
  now: string,
) {
  const facilityId = parseDecimalId(decimalId);
  if (Option.isNone(facilityId)) {
    return Option.none<PersonnelRecords>();
  }
  const [current, buildingRows, recorders, employeeRows, statusEvents] =
    yield* readFacility(facilityId.value, now);
  if (current === null) {
    return Option.none<PersonnelRecords>();
  }
  const records = {
    facilityId: facilityId.value,
    facilityDate: current.facilityDate,
    buildings: buildingRows,
    recorders,
    employees: employeeRows,
    statusEvents,
  };
  if (current.decision === null) {
    return Option.some<PersonnelRecords>({
      ...records,
      decision: null,
      posture: { kind: "none" },
      directives: [],
    });
  }
  const { chosenPosture, ...decision } = current.decision;
  const posture: CurrentPosture = postureOfDecision(
    { action: decision.action, chosenPosture },
    yield* snapshotOf(decision.recommendationId),
  );
  return Option.some<PersonnelRecords>({
    ...records,
    decision,
    posture,
    directives: yield* listDirectives(decision.id),
  });
});

export { loadPersonnelRecords };
