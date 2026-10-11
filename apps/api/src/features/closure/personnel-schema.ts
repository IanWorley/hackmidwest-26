import {
  DECISION_ACTIONS,
  employeeStatusEvents,
  NOTIFICATION_CHANNELS,
  POSTURES,
} from "@hackmidwest/db";
import { createSchemaFactory } from "drizzle-typebox";
import { t } from "elysia";

const { createSelectSchema } = createSchemaFactory({ typeboxInstance: t });

const positiveId = t.Integer({ minimum: 1 });
const statusEventSchema = createSelectSchema(employeeStatusEvents);

const baselineSchema = t.Union([
  t.Object({
    status: t.UnionEnum(["working_onsite", "teleworking"]),
    event: t.Nullable(statusEventSchema),
  }),
  t.Object({
    status: t.Literal("not_working"),
    note: t.String(),
    event: statusEventSchema,
  }),
]);

const directiveSchema = t.Object({
  id: positiveId,
  scope: t.Union([
    t.Object({ kind: t.Literal("facility") }),
    t.Object({ kind: t.Literal("group"), group: t.Literal("essential") }),
    t.Object({ kind: t.Literal("building"), buildingId: positiveId }),
    t.Object({ kind: t.Literal("employee"), employeeId: positiveId }),
  ]),
  directive: t.UnionEnum(["report", "telework", "dismissed", "excused"]),
  effectiveAt: t.Nullable(t.String()),
  reasonCategory: t.String(),
  reasonText: t.String(),
  issuedById: positiveId,
  issuedAt: t.String(),
});

const causeSchema = t.Union([
  t.Object({ source: t.Literal("baseline"), baseline: baselineSchema }),
  t.Object({ source: t.Literal("posture"), posture: t.UnionEnum(POSTURES) }),
  t.Object({ source: t.Literal("directive"), directive: directiveSchema }),
]);

const releaseSchema = t.Union([
  t.Literal("all_day"),
  t.Object({ at: t.String() }),
]);

const effectiveStatusSchema = t.Union([
  t.Object({ kind: t.Literal("working_onsite"), cause: causeSchema }),
  t.Object({ kind: t.Literal("teleworking"), cause: causeSchema }),
  t.Object({
    kind: t.Literal("delayed_arrival"),
    delayMinutes: t.Number(),
    cause: causeSchema,
  }),
  t.Object({ kind: t.Literal("report_required"), cause: causeSchema }),
  t.Object({
    kind: t.Literal("dismissed"),
    release: releaseSchema,
    cause: causeSchema,
  }),
  t.Object({
    kind: t.Literal("not_working"),
    note: t.String(),
    cause: causeSchema,
  }),
]);

const facilityPostureSchema = t.Union([
  t.Object({ posture: t.Literal("normal") }),
  t.Object({
    posture: t.Literal("delayed_arrival"),
    delayMinutes: t.Number(),
  }),
  t.Object({ posture: t.Literal("early_dismissal"), releaseAt: t.String() }),
  t.Object({ posture: t.Literal("unscheduled_telework") }),
  t.Object({ posture: t.Literal("full_closure") }),
]);

/** The facility's posture today. `none` means nobody has decided anything yet. */
const postureStateSchema = t.Union([
  t.Object({ kind: t.Literal("none") }),
  t.Object({ kind: t.Literal("decided"), posture: facilityPostureSchema }),
  t.Object({
    kind: t.Literal("undecided"),
    action: t.UnionEnum(["defer", "no_decision"]),
  }),
]);
const untimedPostureSchema = t.Object({
  kind: t.Literal("untimed"),
  posture: t.UnionEnum(["delayed_arrival", "early_dismissal"]),
});

const personSchema = t.Object({
  employeeId: positiveId,
  name: t.String(),
  buildingId: positiveId,
  essentialPersonnel: t.Boolean(),
  teleworkEligible: t.Boolean(),
  email: t.String(),
  mobilePhone: t.Nullable(t.String()),
  preferredChannel: t.UnionEnum(NOTIFICATION_CHANNELS),
  /** A flag only; the needs themselves travel with notifications, not with a list view. */
  hasAccessibilityNeeds: t.Boolean(),
  baseline: baselineSchema,
  /** The newest event reported so far, which may take effect later than now. */
  latestEvent: t.Nullable(statusEventSchema),
});

const personnelContextFields = {
  facilityId: positiveId,
  /** `YYYY-MM-DD`: the facility day the statuses are for. After closing time it is tomorrow. */
  facilityDate: t.String(),
  /** The instant every status in the response was resolved at. */
  asOf: t.String(),
  /** The facility's newest decision, which sets today's posture and holds its directives. */
  decision: t.Nullable(
    t.Object({
      id: positiveId,
      recommendationId: positiveId,
      action: t.UnionEnum(DECISION_ACTIONS),
      decidedAt: t.String(),
    }),
  ),
  buildings: t.Array(t.Object({ id: positiveId, name: t.String() })),
  /** Who may record a status here: the facility's decision maker and its backup. */
  recorders: t.Array(
    t.Object({ id: positiveId, name: t.String(), role: t.String() }),
  ),
};

/**
 * An override to a delayed arrival or early dismissal that no recommendation timed has no delay or
 * release to resolve against, so its people come back without an effective status instead of a guessed one.
 */
const personnelResponse = t.Union([
  t.Object({
    ...personnelContextFields,
    posture: postureStateSchema,
    people: t.Array(
      t.Object({
        ...personSchema.properties,
        effective: effectiveStatusSchema,
      }),
    ),
  }),
  t.Object({
    ...personnelContextFields,
    posture: untimedPostureSchema,
    people: t.Array(personSchema),
  }),
]);
type PersonnelResponse = typeof personnelResponse.static;
type PostureState = typeof postureStateSchema.static;

export type { PersonnelResponse, PostureState };
export { personnelResponse };
