import {
  buildingRosterEntries,
  buildings,
  type Database as DrizzleDatabase,
  employeeStatusEvents,
  employees,
  facilities,
} from "@hackmidwest/db";
import { eq, getTableColumns } from "drizzle-orm";
import { Data, Effect, Option } from "effect";
import { Elysia } from "elysia";
import {
  Database,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
  internalServerErrorResponse,
  type RunRequest,
} from "../../runtime";
import { decimalIdParams } from "../decimal-id";
import type { FacilityPosture } from "./effective-status";
import type { AlertUrgency, NoticeContext } from "./notification-plan";
import {
  type NotificationPreview,
  NotificationPreviewSchema,
  type PreviewSource,
} from "./notification-preview-schema";
import {
  buildNotificationPackage,
  type NotificationPackageInput,
} from "./notifications";
import {
  parseAs,
  type Snapshot,
  SnapshotSchema,
} from "./recommendation-schema";
import { findRecommendation } from "./recommendation-store";
import {
  RECOMMENDATION_PATH,
  recommendationNotFound,
  recommendationNotFoundResponse,
} from "./recommendations";

const NOTIFICATION_PREVIEW_PATH = `${RECOMMENDATION_PATH}/notifications/preview`;
const MINUTES_PER_HOUR = 60;
const NO_ALERT_URGENCY: AlertUrgency = "Unknown";

type FacilityRoster = Pick<
  NotificationPackageInput,
  "facility" | "employees" | "rosterEntries" | "statusEvents"
>;

class NotificationPreviewStorageError extends Data.TaggedError(
  "NotificationPreviewStorageError",
)<{
  readonly cause: unknown;
}> {}

const previewRoute = {
  params: decimalIdParams,
  response: {
    [HTTP_OK]: NotificationPreviewSchema,
    [HTTP_NOT_FOUND]: recommendationNotFoundResponse,
    [HTTP_INTERNAL_SERVER_ERROR]: internalServerErrorResponse,
  },
};

function facilityPosture(
  status: Snapshot["output"]["status"],
): FacilityPosture {
  switch (status.posture) {
    case "delayed_arrival":
      return {
        posture: status.posture,
        delayMinutes: status.delayHours * MINUTES_PER_HOUR,
      };
    case "early_dismissal":
      return { posture: status.posture, releaseAt: status.departAt };
    default:
      return { posture: status.posture };
  }
}

function drivingHazard({
  driver,
}: Snapshot["output"]): NoticeContext["hazard"] {
  if (driver === null) {
    return null;
  }
  const { start, end } = driver.timing.hazardWindow;
  return { kind: driver.hazard, start, end };
}

/** The urgency of the alert behind the driving crossing; a forecast or reading crossing has none. */
function drivingUrgency({ input, output }: Snapshot): AlertUrgency {
  const { driver } = output;
  if (driver === null) {
    return NO_ALERT_URGENCY;
  }
  const outcome = output.hazards
    .find(({ hazard }) => hazard === driver.hazard)
    ?.checks.find(({ cutoff }) => cutoff === driver.cutoff)?.outcome;
  if (outcome?.kind !== "crossed" || outcome.input.kind !== "alert") {
    return NO_ALERT_URGENCY;
  }
  const alertId = outcome.input.ref;
  return (
    input.alerts.find(({ id }) => id === alertId)?.urgency ?? NO_ALERT_URGENCY
  );
}

/** No decision exists at preview time, so no directives apply. */
function previewInput(
  recommendationId: number,
  snapshot: Snapshot,
  roster: FacilityRoster,
): NotificationPackageInput<PreviewSource> {
  return {
    ...roster,
    source: { kind: "preview", recommendationId },
    posture: facilityPosture(snapshot.output.status),
    directives: [],
    now: snapshot.input.now,
    facilityDate: snapshot.output.facilityDate,
    hazard: drivingHazard(snapshot.output),
    urgency: drivingUrgency(snapshot),
  };
}

function noticeFacility(
  db: DrizzleDatabase,
  facilityId: number,
): Promise<FacilityRoster["facility"][]> {
  return db
    .select({
      name: facilities.name,
      timezone: facilities.timezone,
      arrivalWindowStart: facilities.arrivalWindowStart,
      closesAt: facilities.closesAt,
      typicalCommuteMinutes: facilities.typicalCommuteMinutes,
      notificationLeadMinutes: facilities.notificationLeadMinutes,
    })
    .from(facilities)
    .where(eq(facilities.id, facilityId));
}

/** HR employees, roster entries, and status events, each scoped through its building to the facility. */
function facilityStaff(
  db: DrizzleDatabase,
  facilityId: number,
): Promise<
  [
    FacilityRoster["employees"],
    FacilityRoster["rosterEntries"],
    FacilityRoster["statusEvents"],
  ]
> {
  const inFacility = eq(buildings.facilityId, facilityId);
  return Promise.all([
    db
      .select(getTableColumns(employees))
      .from(employees)
      .innerJoin(buildings, eq(employees.assignedBuildingId, buildings.id))
      .where(inFacility),
    db
      .select(getTableColumns(buildingRosterEntries))
      .from(buildingRosterEntries)
      .innerJoin(buildings, eq(buildingRosterEntries.buildingId, buildings.id))
      .where(inFacility),
    db
      .select(getTableColumns(employeeStatusEvents))
      .from(employeeStatusEvents)
      .innerJoin(employees, eq(employeeStatusEvents.employeeId, employees.id))
      .innerJoin(buildings, eq(employees.assignedBuildingId, buildings.id))
      .where(inFacility),
  ]);
}

const loadFacilityRoster = Effect.fn("loadFacilityRoster")(function* (
  facilityId: number,
) {
  const db = yield* Database;
  const [[facility], [staff, rosterEntries, statusEvents]] =
    yield* Effect.tryPromise({
      try: () =>
        Promise.all([
          noticeFacility(db, facilityId),
          facilityStaff(db, facilityId),
        ]),
      catch: (cause) => new NotificationPreviewStorageError({ cause }),
    });
  if (facility === undefined) {
    return yield* Effect.die("a stored recommendation's facility is missing");
  }
  return {
    facility,
    employees: staff,
    rosterEntries,
    statusEvents,
  } satisfies FacilityRoster;
});

const previewRequest = Effect.fn("previewRequest")(function* (
  decimalId: string,
) {
  const row = yield* findRecommendation(decimalId);
  if (Option.isNone(row)) {
    return recommendationNotFound();
  }
  const { id, facilityId } = row.value;
  const snapshot = yield* parseAs(SnapshotSchema, row.value.snapshot);
  const roster = yield* loadFacilityRoster(facilityId);
  const preview: NotificationPreview = buildNotificationPackage(
    previewInput(id, snapshot, roster),
  );
  return yield* parseAs(NotificationPreviewSchema, preview);
});

export function createNotificationPreviewModule(runRequest: RunRequest) {
  return new Elysia({ name: "notification-preview" }).get(
    NOTIFICATION_PREVIEW_PATH,
    ({ params }) => runRequest(previewRequest(params.id)),
    previewRoute,
  );
}
