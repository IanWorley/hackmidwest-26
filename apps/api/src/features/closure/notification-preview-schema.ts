import {
  buildingRosterEntries,
  employeeStatusEvents,
  employees,
  facilities,
  HAZARDS,
  NOTIFICATION_CHANNELS,
} from "@hackmidwest/db";
import { createSchemaFactory } from "drizzle-typebox";
import { t } from "elysia";
import { AlertUrgencySchema } from "../../clients/nws-model";
import { DIRECTIVE_KINDS } from "./directives";
import type { NotificationPackage } from "./notifications";
import { postureSchema } from "./postures";
import { type AssertTrue, closedObject, type Mirrors } from "./schema-mirror";

const { createSelectSchema } = createSchemaFactory({ typeboxInstance: t });
const facilityColumns = createSelectSchema(facilities).properties;
const EmployeeSchema = closedObject(createSelectSchema(employees).properties);
const RosterEntrySchema = closedObject(
  createSelectSchema(buildingRosterEntries).properties,
);
const StatusEventSchema = closedObject(
  createSelectSchema(employeeStatusEvents).properties,
);

const FacilityPostureSchema = t.Union([
  closedObject({ posture: t.Literal("normal") }),
  closedObject({
    posture: t.Literal("delayed_arrival"),
    delayMinutes: t.Number(),
  }),
  closedObject({
    posture: t.Literal("early_dismissal"),
    releaseAt: t.String(),
  }),
  closedObject({ posture: t.Literal("unscheduled_telework") }),
  closedObject({ posture: t.Literal("full_closure") }),
]);

const NoticeContextSchema = closedObject({
  facility: closedObject({
    name: facilityColumns.name,
    timezone: facilityColumns.timezone,
    arrivalWindowStart: facilityColumns.arrivalWindowStart,
    closesAt: facilityColumns.closesAt,
    typicalCommuteMinutes: facilityColumns.typicalCommuteMinutes,
    notificationLeadMinutes: facilityColumns.notificationLeadMinutes,
  }),
  facilityDate: t.String(),
  posture: FacilityPostureSchema,
  hazard: t.Union([
    closedObject({
      kind: t.UnionEnum(HAZARDS),
      start: t.String(),
      end: t.String(),
    }),
    t.Null(),
  ]),
  urgency: AlertUrgencySchema,
  now: t.String(),
});

const BaselineSchema = t.Union([
  closedObject({
    status: t.UnionEnum(["working_onsite", "teleworking"]),
    event: t.Union([StatusEventSchema, t.Null()]),
  }),
  closedObject({
    status: t.Literal("not_working"),
    note: t.String(),
    event: StatusEventSchema,
  }),
]);

const DirectiveSchema = closedObject({
  id: t.Number(),
  scope: t.Union([
    closedObject({ kind: t.Literal("facility") }),
    closedObject({ kind: t.Literal("group"), group: t.Literal("essential") }),
    closedObject({ kind: t.Literal("building"), buildingId: t.Number() }),
    closedObject({ kind: t.Literal("employee"), employeeId: t.Number() }),
  ]),
  directive: t.UnionEnum(DIRECTIVE_KINDS),
  effectiveAt: t.Union([t.String(), t.Null()]),
  reasonCategory: t.String(),
  reasonText: t.String(),
  issuedById: t.Number(),
  issuedAt: t.String(),
});

const cause = {
  cause: t.Union([
    closedObject({ source: t.Literal("baseline"), baseline: BaselineSchema }),
    closedObject({ source: t.Literal("posture"), posture: postureSchema }),
    closedObject({
      source: t.Literal("directive"),
      directive: DirectiveSchema,
    }),
  ]),
};

const EffectiveStatusSchema = t.Union([
  closedObject({ ...cause, kind: t.Literal("working_onsite") }),
  closedObject({ ...cause, kind: t.Literal("teleworking") }),
  closedObject({
    ...cause,
    kind: t.Literal("delayed_arrival"),
    delayMinutes: t.Number(),
  }),
  closedObject({ ...cause, kind: t.Literal("report_required") }),
  closedObject({
    ...cause,
    kind: t.Literal("dismissed"),
    release: t.Union([t.Literal("all_day"), closedObject({ at: t.String() })]),
  }),
  closedObject({ ...cause, kind: t.Literal("not_working"), note: t.String() }),
]);

const RosterMatchSchema = t.Union([
  closedObject({
    kind: t.Literal("matched"),
    entry: RosterEntrySchema,
    alsoListed: t.Array(RosterEntrySchema),
  }),
  closedObject({ kind: t.Literal("unrostered") }),
  closedObject({
    kind: t.Literal("misfiled"),
    entries: t.Array(RosterEntrySchema, { minItems: 1 }),
  }),
]);

const line = {
  employee: EmployeeSchema,
  status: closedObject({
    baseline: BaselineSchema,
    effective: EffectiveStatusSchema,
  }),
  roster: RosterMatchSchema,
};

const notifyReason = t.UnionEnum([
  "status_changes",
  "directive_issued",
  "posture_announcement",
]);

const NotifyLineSchema = closedObject({ ...line, reason: notifyReason });

const DeliverySchema = closedObject({
  anchor: t.Union([
    closedObject({
      kind: t.Literal("before_commute"),
      start: closedObject({
        at: t.String(),
        source: t.UnionEnum(["shift", "arrival_window"]),
      }),
      commute: closedObject({
        minutes: t.Number(),
        source: t.UnionEnum(["employee", "facility"]),
      }),
    }),
    closedObject({ kind: t.Literal("release"), releaseAt: t.String() }),
  ]),
  sendBy: t.String(),
  late: t.Boolean(),
  rule: t.UnionEnum(["fastest", "preferred"]),
  channel: t.UnionEnum(NOTIFICATION_CHANNELS),
});

const MessageDraftSchema = closedObject({
  subject: t.String(),
  whatsHappening: t.String(),
  appliesToYou: t.String(),
  whatToDo: t.String(),
});

const NotificationPreviewSchema = closedObject({
  source: closedObject({
    kind: t.Literal("preview"),
    recommendationId: t.Number(),
  }),
  context: NoticeContextSchema,
  recipients: t.Array(
    closedObject({
      ...NotifyLineSchema.properties,
      delivery: DeliverySchema,
      message: MessageDraftSchema,
    }),
  ),
  exclusions: t.Array(
    t.Union([
      closedObject({
        kind: t.Literal("skipped"),
        line: closedObject({
          ...line,
          reason: t.UnionEnum([
            "no_change",
            "already_teleworking",
            "not_working",
          ]),
        }),
      }),
      closedObject({ kind: t.Literal("excused"), line: NotifyLineSchema }),
      closedObject({
        kind: t.Literal("unmatched"),
        line: closedObject({
          entry: RosterEntrySchema,
          reason: t.UnionEnum(["not_in_hr", "assigned_elsewhere"]),
        }),
      }),
    ]),
  ),
});

type PreviewSource = Extract<
  NotificationPackage["source"],
  { readonly kind: "preview" }
>;
type NotificationPreview = NotificationPackage<PreviewSource>;

/** Fails to compile when the package types and this schema drift in either direction. */
type _PreviewMirrorsPackage = AssertTrue<
  Mirrors<NotificationPreview, typeof NotificationPreviewSchema.static>
>;

export type { NotificationPreview, PreviewSource };
export { NotificationPreviewSchema };
