import { CONFIDENCE_LEVELS, facilities, HAZARDS } from "@hackmidwest/db";
import type { Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { createSchemaFactory } from "drizzle-typebox";
import { Data, Effect } from "effect";
import { t } from "elysia";
import { ForecastSchema, NwsAlertSchema } from "../../clients/nws-model";
import type { CutoffName } from "./cutoff-names";
import type { InputKind } from "./freshness";
import type { EndBasis } from "./hazard-window";
import { type Posture, postureSchema } from "./postures";
import { ReadingSchema } from "./readings";
import { NWS_SEVERITIES, WIND_METRICS } from "./thresholds";

const MAX_SHAPE_ERRORS = 5;

const INPUT_KINDS = [
  "observations",
  "forecast",
  "airQuality",
] as const satisfies readonly InputKind[];

const CUTOFF_NAMES = [
  "stormWarning",
  "advisory",
  "sustained",
  "gust",
  "unhealthy",
  "veryUnhealthy",
] as const satisfies readonly CutoffName[];

const { createSelectSchema } = createSchemaFactory({ typeboxInstance: t });
const facilityColumns = createSelectSchema(facilities).properties;

const hazardSchema = t.UnionEnum(HAZARDS);
const disruptivePostureSchema = t.UnionEnum([
  "delayed_arrival",
  "early_dismissal",
  "unscheduled_telework",
  "full_closure",
] as const satisfies readonly Exclude<Posture, "normal">[]);
const inputKindSchema = t.UnionEnum(INPUT_KINDS);
const cutoffNameSchema = t.UnionEnum(CUTOFF_NAMES);

const EngineFacilitySchema = t.Object({
  timezone: facilityColumns.timezone,
  opensAt: facilityColumns.opensAt,
  closesAt: facilityColumns.closesAt,
  arrivalWindowStart: facilityColumns.arrivalWindowStart,
  arrivalWindowEnd: facilityColumns.arrivalWindowEnd,
  typicalCommuteMinutes: facilityColumns.typicalCommuteMinutes,
  roadClass: facilityColumns.roadClass,
  decisionDeadline: facilityColumns.decisionDeadline,
  hazardProfile: t.Array(hazardSchema),
});

const EngineInputSchema = t.Object({
  now: t.String(),
  facility: EngineFacilitySchema,
  readings: t.Array(ReadingSchema),
  alerts: t.Array(NwsAlertSchema),
  forecast: ForecastSchema,
});

const OpmStatusSchema = t.Union([
  t.Object({ posture: t.Literal("normal") }),
  t.Object({ posture: t.Literal("delayed_arrival"), delayHours: t.Number() }),
  t.Object({
    posture: t.Literal("early_dismissal"),
    departAt: t.String(),
    departAtLocal: t.String(),
  }),
  t.Object({ posture: t.Literal("unscheduled_telework") }),
  t.Object({ posture: t.Literal("full_closure") }),
]);

const InputRefSchema = t.Object({
  kind: t.Union([inputKindSchema, t.Literal("alert")]),
  source: ReadingSchema.properties.source,
  ref: t.String(),
  asOf: t.String(),
});

const CaveatSchema = t.Union([
  t.Object({
    kind: t.Literal("staleInput"),
    input: inputKindSchema,
    ageMinutes: t.Number(),
    limitMinutes: t.Number(),
  }),
  t.Object({
    kind: t.Literal("missingReading"),
    hazard: hazardSchema,
    cutoff: cutoffNameSchema,
  }),
  t.Object({
    kind: t.Literal("estimatedEnd"),
    endBasis: t.UnionEnum([
      "expires",
      "forecast",
    ] as const satisfies readonly EndBasis[]),
  }),
]);

const PeriodSchema = t.Object({ startTime: t.String(), endTime: t.String() });

const HazardEvidenceSchema = t.Union([
  t.Object({
    source: t.Literal("alert"),
    window: NwsAlertSchema.properties.hazardWindow,
    exceedingPeriods: t.Array(PeriodSchema),
  }),
  t.Object({
    source: t.Literal("forecast"),
    exceedingPeriods: t.Array(PeriodSchema, { minItems: 1 }),
  }),
]);

const TimingCaseSchema = t.Union([
  t.Object({ kind: t.Literal("clearsBeforeArrival") }),
  t.Object({ kind: t.Literal("alreadyCleared") }),
  t.Object({ kind: t.Literal("delayWithinCap"), delayHours: t.Number() }),
  t.Object({ kind: t.Literal("outlastsDelayCap"), delayHours: t.Number() }),
  t.Object({ kind: t.Literal("startsDuringHours"), releaseAt: t.String() }),
  t.Object({ kind: t.Literal("spansOperatingDay") }),
  t.Object({ kind: t.Literal("startsAfterHours"), nextDay: t.String() }),
]);

const TimingResultSchema = t.Object({
  facilityDate: t.String(),
  hazardWindow: t.Object({
    start: t.String(),
    end: t.String(),
    endBasis: t.UnionEnum([
      "ends",
      "expires",
      "forecast",
    ] as const satisfies readonly EndBasis[]),
    clearsAt: t.String(),
  }),
  timingCase: TimingCaseSchema,
  status: OpmStatusSchema,
});

const citation = { source: t.String(), citation: t.String() };

const CutoffSchema = t.Union([
  t.Object({
    value: t.UnionEnum(NWS_SEVERITIES),
    unit: t.Literal("nws_severity"),
    events: t.Array(t.String(), { minItems: 1 }),
    posture: disruptivePostureSchema,
    ...citation,
  }),
  t.Object({
    value: t.Number(),
    unit: t.Literal("mph"),
    metric: t.UnionEnum(WIND_METRICS),
    minDurationMinutes: t.Number(),
    posture: disruptivePostureSchema,
    ...citation,
  }),
  t.Object({
    value: t.Number(),
    unit: t.Literal("aqi"),
    posture: disruptivePostureSchema,
    ...citation,
  }),
]);

const measurement = {
  observed: t.Union([t.Number(), t.UnionEnum(NWS_SEVERITIES)]),
  margin: t.Number(),
  input: InputRefSchema,
};

const CheckOutcomeSchema = t.Union([
  t.Object({ kind: t.Literal("absent") }),
  t.Object({ kind: t.Literal("below"), ...measurement }),
  t.Object({
    kind: t.Literal("crossed"),
    evidence: HazardEvidenceSchema,
    timing: TimingResultSchema,
    ...measurement,
  }),
]);

const HazardAssessmentSchema = t.Object({
  hazard: hazardSchema,
  posture: postureSchema,
  checks: t.Array(
    t.Object({
      cutoff: cutoffNameSchema,
      threshold: CutoffSchema,
      outcome: CheckOutcomeSchema,
      nextDay: t.Union([t.String(), t.Null()]),
    }),
  ),
});

const RecommendationSchema = t.Object({
  status: OpmStatusSchema,
  confidence: t.UnionEnum(CONFIDENCE_LEVELS),
  caveats: t.Array(CaveatSchema),
  facilityDate: t.String(),
  decideBy: t.String(),
  hazards: t.Array(HazardAssessmentSchema),
  driver: t.Union([
    t.Object({
      hazard: hazardSchema,
      cutoff: cutoffNameSchema,
      timing: TimingResultSchema,
    }),
    t.Null(),
  ]),
  nextDay: t.Union([t.String(), t.Null()]),
  inputs: t.Array(InputRefSchema),
  sensitivity: t.Array(
    t.Object({
      shiftMinutes: t.Number(),
      status: OpmStatusSchema,
      statement: t.String(),
    }),
  ),
  rationale: t.String(),
});

const SnapshotSchema = t.Object({
  input: EngineInputSchema,
  output: RecommendationSchema,
});

type Snapshot = Static<typeof SnapshotSchema>;

class SnapshotShapeError extends Data.TaggedError("SnapshotShapeError")<{
  readonly errors: readonly string[];
}> {}

function parseAs<Schema extends TSchema>(
  schema: Schema,
  value: unknown,
): Effect.Effect<Static<Schema>, SnapshotShapeError> {
  if (Value.Check(schema, value)) {
    return Effect.succeed(value);
  }
  const errors = [...Value.Errors(schema, value)]
    .slice(0, MAX_SHAPE_ERRORS)
    .map(({ path, message }) => `${path} ${message}`);
  return Effect.fail(new SnapshotShapeError({ errors }));
}

export type { Snapshot, SnapshotShapeError };
export { parseAs, RecommendationSchema, SnapshotSchema };
