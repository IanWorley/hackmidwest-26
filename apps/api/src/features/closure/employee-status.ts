import {
  buildings,
  EMPLOYEE_STATUSES,
  employeeStatusEvents,
  employees,
  facilities,
} from "@hackmidwest/db";
import { eq } from "drizzle-orm";
import { createSchemaFactory } from "drizzle-typebox";
import { Data, DateTime, Effect, Option } from "effect";
import { type ElysiaCustomStatusResponse, status, t } from "elysia";
import {
  Database,
  HTTP_CREATED,
  HTTP_NOT_FOUND,
  HTTP_UNPROCESSABLE_ENTITY,
} from "../../runtime";
import {
  invalidBody,
  nonBlankText,
  utcInstant,
  type ValidationErrorBody,
} from "./decision-body";
import { parseDecimalId } from "./facilities";

const EMPLOYEE_STATUS_PATH = "/api/employees/:id/status";
const EMPLOYEE_NOT_FOUND_MESSAGE = "Employee not found";
const REPORTER_NOT_ELIGIBLE_MESSAGE =
  "Only the facility's decision maker or its backup can record a status";
const NOTE_REQUIRED_MESSAGE = "A not_working status needs a note";
const STATUS_FIELDS = {
  note: "/note",
  reportedById: "/reportedById",
} as const;

const { createSelectSchema } = createSchemaFactory({ typeboxInstance: t });

const statusEventBody = t.Object({
  status: t.UnionEnum(EMPLOYEE_STATUSES),
  /** Required for not_working, where it says why (leave, detail elsewhere). */
  note: t.Optional(nonBlankText),
  /** A decision maker for the employee's facility. Employees never report their own status. */
  reportedById: t.Integer(),
  /** Defaults to the time the event is recorded. A later time schedules the change. */
  effectiveFrom: t.Optional(utcInstant),
});

type StatusEventBody = typeof statusEventBody.static;

const statusEventResponse = createSelectSchema(employeeStatusEvents);
type StatusEventRow = typeof employeeStatusEvents.$inferSelect;

const employeeNotFoundResponse = t.Object({
  message: t.Literal(EMPLOYEE_NOT_FOUND_MESSAGE),
});

type StatusEventOutcome =
  | ElysiaCustomStatusResponse<typeof HTTP_CREATED, StatusEventRow>
  | ElysiaCustomStatusResponse<
      typeof HTTP_NOT_FOUND,
      typeof employeeNotFoundResponse.static
    >
  | ElysiaCustomStatusResponse<
      typeof HTTP_UNPROCESSABLE_ENTITY,
      ValidationErrorBody
    >;

class StatusEventStorageError extends Data.TaggedError(
  "StatusEventStorageError",
)<{
  readonly operation: "reporters" | "insert";
  readonly cause: unknown;
}> {}

function employeeNotFound(): StatusEventOutcome {
  return status(HTTP_NOT_FOUND, { message: EMPLOYEE_NOT_FOUND_MESSAGE });
}

function rejected(property: string, message: string): StatusEventOutcome {
  return status(HTTP_UNPROCESSABLE_ENTITY, invalidBody(property, message));
}

/** The decision makers who may record this employee's status, or none for an unknown employee. */
const eligibleReporters = Effect.fn("eligibleReporters")(function* (
  employeeId: number,
) {
  const db = yield* Database;
  const [row] = yield* Effect.tryPromise({
    try: () =>
      db
        .select({
          decisionMakerId: facilities.decisionMakerId,
          backupDecisionMakerId: facilities.backupDecisionMakerId,
        })
        .from(employees)
        .innerJoin(buildings, eq(buildings.id, employees.assignedBuildingId))
        .innerJoin(facilities, eq(facilities.id, buildings.facilityId))
        .where(eq(employees.id, employeeId)),
    catch: (cause) =>
      new StatusEventStorageError({ operation: "reporters", cause }),
  });
  return Option.map(Option.fromNullishOr(row), (facility) => [
    facility.decisionMakerId,
    facility.backupDecisionMakerId,
  ]);
});

/** Appends one status event. The table is add-only, so a correction is a newer event. */
const recordStatusEvent = Effect.fn("recordStatusEvent")(function* (
  decimalId: string,
  body: StatusEventBody,
) {
  const employeeId = parseDecimalId(decimalId);
  if (Option.isNone(employeeId)) {
    return employeeNotFound();
  }
  const reporters = yield* eligibleReporters(employeeId.value);
  if (Option.isNone(reporters)) {
    return employeeNotFound();
  }
  if (!reporters.value.includes(body.reportedById)) {
    return rejected(STATUS_FIELDS.reportedById, REPORTER_NOT_ELIGIBLE_MESSAGE);
  }
  if (body.status === "not_working" && body.note === undefined) {
    return rejected(STATUS_FIELDS.note, NOTE_REQUIRED_MESSAGE);
  }
  const reportedAt = DateTime.formatIso(yield* DateTime.now);
  const db = yield* Database;
  const [event] = yield* Effect.tryPromise({
    try: () =>
      db
        .insert(employeeStatusEvents)
        .values({
          employeeId: employeeId.value,
          status: body.status,
          note: body.note ?? null,
          reportedById: body.reportedById,
          reportedAt,
          effectiveFrom: body.effectiveFrom ?? reportedAt,
        })
        .returning(),
    catch: (cause) =>
      new StatusEventStorageError({ operation: "insert", cause }),
  });
  if (event === undefined) {
    return yield* Effect.die("The status event insert returned no row");
  }
  return status(HTTP_CREATED, event);
});

export type { StatusEventOutcome };
export {
  EMPLOYEE_STATUS_PATH,
  employeeNotFoundResponse,
  recordStatusEvent,
  statusEventBody,
  statusEventResponse,
};
