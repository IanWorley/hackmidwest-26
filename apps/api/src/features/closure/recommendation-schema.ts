import { CONFIDENCE_LEVELS, facilities, HAZARDS } from "@hackmidwest/db";
import type { Static, TObject, TProperties, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { createSchemaFactory } from "drizzle-typebox";
import { Data, Effect } from "effect";
import { t } from "elysia";
import { ForecastSchema, NwsAlertSchema } from "../../clients/nws-model";
import type { CutoffName } from "./cutoff-names";
import type { EngineInput, Recommendation } from "./engine";
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

/** Rejects unknown keys, so a field the schema lacks fails the insert instead of being hashed and then stripped from responses. */
function closedObject<Properties extends TProperties>(
  properties: Properties,
): TObject<Properties> {
  return t.Object(properties, { additionalProperties: false });
}

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

const EngineFacilitySchema = closedObject({
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

const EngineInputSchema = closedObject({
  now: t.String(),
  facility: EngineFacilitySchema,
  readings: t.Array(ReadingSchema),
  alerts: t.Array(NwsAlertSchema),
  forecast: ForecastSchema,
});

const OpmStatusSchema = t.Union([
  closedObject({ posture: t.Literal("normal") }),
  closedObject({
    posture: t.Literal("delayed_arrival"),
    delayHours: t.Number(),
  }),
  closedObject({
    posture: t.Literal("early_dismissal"),
    departAt: t.String(),
    departAtLocal: t.String(),
  }),
  closedObject({ posture: t.Literal("unscheduled_telework") }),
  closedObject({ posture: t.Literal("full_closure") }),
]);

const InputRefSchema = closedObject({
  kind: t.Union([inputKindSchema, t.Literal("alert")]),
  source: ReadingSchema.properties.source,
  ref: t.String(),
  asOf: t.String(),
});

const CaveatSchema = t.Union([
  closedObject({
    kind: t.Literal("staleInput"),
    input: inputKindSchema,
    ageMinutes: t.Number(),
    limitMinutes: t.Number(),
  }),
  closedObject({
    kind: t.Literal("missingReading"),
    hazard: hazardSchema,
    cutoff: cutoffNameSchema,
  }),
  closedObject({
    kind: t.Literal("estimatedEnd"),
    endBasis: t.UnionEnum([
      "expires",
      "forecast",
    ] as const satisfies readonly EndBasis[]),
  }),
]);

const PeriodSchema = closedObject({
  startTime: t.String(),
  endTime: t.String(),
});

const HazardEvidenceSchema = t.Union([
  closedObject({
    source: t.Literal("alert"),
    window: NwsAlertSchema.properties.hazardWindow,
    exceedingPeriods: t.Array(PeriodSchema),
  }),
  closedObject({
    source: t.Literal("forecast"),
    exceedingPeriods: t.Array(PeriodSchema, { minItems: 1 }),
  }),
]);

const TimingCaseSchema = t.Union([
  closedObject({ kind: t.Literal("clearsBeforeArrival") }),
  closedObject({ kind: t.Literal("alreadyCleared") }),
  closedObject({ kind: t.Literal("delayWithinCap"), delayHours: t.Number() }),
  closedObject({ kind: t.Literal("outlastsDelayCap"), delayHours: t.Number() }),
  closedObject({ kind: t.Literal("startsDuringHours"), releaseAt: t.String() }),
  closedObject({ kind: t.Literal("spansOperatingDay") }),
  closedObject({ kind: t.Literal("startsAfterHours"), nextDay: t.String() }),
]);

const TimingResultSchema = closedObject({
  facilityDate: t.String(),
  hazardWindow: closedObject({
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
  closedObject({
    value: t.UnionEnum(NWS_SEVERITIES),
    unit: t.Literal("nws_severity"),
    events: t.Array(t.String(), { minItems: 1 }),
    posture: disruptivePostureSchema,
    ...citation,
  }),
  closedObject({
    value: t.Number(),
    unit: t.Literal("mph"),
    metric: t.UnionEnum(WIND_METRICS),
    minDurationMinutes: t.Number(),
    posture: disruptivePostureSchema,
    ...citation,
  }),
  closedObject({
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
  closedObject({ kind: t.Literal("absent") }),
  closedObject({ kind: t.Literal("below"), ...measurement }),
  closedObject({
    kind: t.Literal("crossed"),
    evidence: HazardEvidenceSchema,
    timing: TimingResultSchema,
    ...measurement,
  }),
]);

const HazardAssessmentSchema = closedObject({
  hazard: hazardSchema,
  posture: postureSchema,
  checks: t.Array(
    closedObject({
      cutoff: cutoffNameSchema,
      threshold: CutoffSchema,
      outcome: CheckOutcomeSchema,
      nextDay: t.Union([t.String(), t.Null()]),
    }),
  ),
});

const RecommendationSchema = closedObject({
  status: OpmStatusSchema,
  confidence: t.UnionEnum(CONFIDENCE_LEVELS),
  caveats: t.Array(CaveatSchema),
  facilityDate: t.String(),
  decideBy: t.String(),
  hazards: t.Array(HazardAssessmentSchema),
  driver: t.Union([
    closedObject({
      hazard: hazardSchema,
      cutoff: cutoffNameSchema,
      timing: TimingResultSchema,
    }),
    t.Null(),
  ]),
  nextDay: t.Union([t.String(), t.Null()]),
  inputs: t.Array(InputRefSchema),
  sensitivity: t.Array(
    closedObject({
      shiftMinutes: t.Number(),
      status: OpmStatusSchema,
      statement: t.String(),
    }),
  ),
  rationale: t.String(),
});

const SnapshotSchema = closedObject({
  input: EngineInputSchema,
  output: RecommendationSchema,
});

type Snapshot = Static<typeof SnapshotSchema>;

type DeepMutable<T> = T extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;

type Equal<Left, Right> =
  (<T>() => T extends Left ? true : false) extends <T>() => T extends Right
    ? true
    : false
    ? true
    : false;

type Mirrors<Engine, Schema> = Equal<DeepMutable<Engine>, DeepMutable<Schema>>;

type AssertTrue<Condition extends true> = Condition;

/**
 * Fails to compile when the engine types and these hand-written schemas drift in either direction.
 * Mutual assignability would miss an added optional field, so this demands identical types.
 * DeepMutable reads the engine's non-empty tuples as arrays; `minItems` checks those at runtime.
 */
type _SnapshotMirrorsEngine = [
  AssertTrue<Mirrors<EngineInput, Snapshot["input"]>>,
  AssertTrue<Mirrors<Recommendation, Snapshot["output"]>>,
];

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
