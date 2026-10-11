import { CONFIDENCE_LEVELS, HAZARDS, type Posture } from "@hackmidwest/db";
import type { TObject, TProperties } from "@sinclair/typebox";
import { type Static, t } from "elysia";
import { FLOOD_CATEGORIES } from "../../clients/nwps";
import { CLOSED, type EngineInput, EngineInputSchema } from "./engine-input";
import type { InputKind } from "./freshness";
import type { EndBasis } from "./hazard-window";
import type { Recommendation } from "./recommendation";
import { NWS_SEVERITIES, WIND_METRICS } from "./thresholds";

const INPUT_KINDS = [
  "observations",
  "forecast",
  "airQuality",
  "gauge",
] as const satisfies readonly InputKind[];

const END_BASES = [
  "ends",
  "expires",
  "forecast",
  "reading",
] as const satisfies readonly EndBasis[];

const ALERT_END_BASES = [
  "ends",
  "expires",
] as const satisfies readonly EndBasis[];

const CROSSED_POSTURES = [
  "delayed_arrival",
  "early_dismissal",
  "unscheduled_telework",
  "full_closure",
] as const satisfies readonly Exclude<Posture, "normal">[];

function closed<Properties extends TProperties>(
  properties: Properties,
): TObject<Properties> {
  return t.Object(properties, CLOSED);
}

const HazardSchema = t.UnionEnum(HAZARDS);
const CrossedPostureSchema = t.UnionEnum(CROSSED_POSTURES);
const SeveritySchema = t.UnionEnum(NWS_SEVERITIES);
const WindMetricSchema = t.UnionEnum(WIND_METRICS);
const FloodCategorySchema = t.UnionEnum(FLOOD_CATEGORIES);

const OpmStatusSchema = t.Union([
  closed({ posture: t.Literal("normal") }),
  closed({ posture: t.Literal("delayed_arrival"), delayHours: t.Number() }),
  closed({
    posture: t.Literal("early_dismissal"),
    departAt: t.String(),
    departAtLocal: t.String(),
  }),
  closed({ posture: t.Literal("unscheduled_telework") }),
  closed({ posture: t.Literal("full_closure") }),
]);

const TimingCaseSchema = t.Union([
  closed({ kind: t.Literal("clearsBeforeArrival") }),
  closed({ kind: t.Literal("alreadyCleared") }),
  closed({ kind: t.Literal("delayWithinCap"), delayHours: t.Number() }),
  closed({ kind: t.Literal("outlastsDelayCap"), delayHours: t.Number() }),
  closed({ kind: t.Literal("startsDuringHours"), releaseAt: t.String() }),
  closed({ kind: t.Literal("spansOperatingDay") }),
  closed({ kind: t.Literal("startsAfterHours"), nextDay: t.String() }),
]);

const TimingResultSchema = closed({
  facilityDate: t.String(),
  hazardWindow: closed({
    start: t.String(),
    end: t.String(),
    endBasis: t.UnionEnum(END_BASES),
    clearsAt: t.String(),
  }),
  timingCase: TimingCaseSchema,
  status: OpmStatusSchema,
});

const cited = {
  source: t.String(),
  citation: t.String(),
  posture: CrossedPostureSchema,
};

const CutoffSchema = t.Union([
  closed({
    value: SeveritySchema,
    unit: t.Literal("nws_severity"),
    events: t.Array(t.String(), { minItems: 1 }),
    ...cited,
  }),
  closed({
    value: t.Number(),
    unit: t.Literal("mph"),
    metric: WindMetricSchema,
    minDurationMinutes: t.Number(),
    ...cited,
  }),
  closed({
    value: FloodCategorySchema,
    unit: t.Literal("nws_flood_category"),
    ...cited,
  }),
  closed({ value: t.Number(), unit: t.Literal("aqi"), ...cited }),
]);

const margin = { observed: t.Number(), cutoff: t.Number(), by: t.Number() };

const MarginSchema = t.Union([
  closed({
    unit: t.Literal("nws_severity"),
    event: t.String(),
    observed: SeveritySchema,
    cutoff: SeveritySchema,
    by: t.Number(),
  }),
  closed({ unit: t.Literal("mph"), metric: WindMetricSchema, ...margin }),
  closed({ unit: t.Literal("aqi"), ...margin }),
  closed({
    unit: t.Literal("nws_flood_category"),
    category: FloodCategorySchema,
    ...margin,
  }),
]);

const spanned = { ref: t.String(), asOf: t.String(), start: t.String() };

const OriginSchema = t.Union([
  closed({
    source: t.Literal("alerts"),
    ...spanned,
    end: t.String(),
    endBasis: t.UnionEnum(ALERT_END_BASES),
  }),
  closed({
    source: t.UnionEnum(["forecast", "gauge"]),
    ...spanned,
    end: t.String(),
  }),
  closed({
    source: t.UnionEnum(["observations", "airQuality"]),
    ref: t.String(),
    asOf: t.String(),
    holdsUntil: t.String(),
  }),
]);

const SignalSchema = t.Union([
  closed({
    unit: t.Literal("nws_severity"),
    event: t.String(),
    value: SeveritySchema,
    origin: OriginSchema,
  }),
  closed({
    unit: t.Literal("mph"),
    metric: WindMetricSchema,
    value: t.Number(),
    origin: OriginSchema,
  }),
  closed({ unit: t.Literal("aqi"), value: t.Number(), origin: OriginSchema }),
  closed({
    unit: t.Literal("nws_flood_category"),
    value: FloodCategorySchema,
    stageFt: t.Number(),
    floodStageFt: t.Number(),
    origin: OriginSchema,
  }),
]);

const FindingSchema = closed({
  hazard: HazardSchema,
  cutoffId: t.String(),
  cutoff: CutoffSchema,
  margin: MarginSchema,
  signals: t.Array(SignalSchema, { minItems: 1 }),
  timing: TimingResultSchema,
});

const ConfidenceReasonSchema = t.Union([
  closed({ kind: t.Literal("endBasis"), endBasis: t.UnionEnum(END_BASES) }),
  closed({
    kind: t.Literal("stale"),
    input: t.UnionEnum(INPUT_KINDS),
    ageMinutes: t.Number(),
    limitMinutes: t.Number(),
  }),
  closed({ kind: t.Literal("missing"), input: t.UnionEnum(INPUT_KINDS) }),
]);

const SensitivitySchema = t.Union([
  closed({
    kind: t.Literal("onsetShift"),
    shiftMinutes: t.Number(),
    status: OpmStatusSchema,
  }),
  closed({
    kind: t.Literal("withoutFinding"),
    hazard: HazardSchema,
    cutoffId: t.String(),
    margin: MarginSchema,
    status: OpmStatusSchema,
  }),
]);

const RecommendationSchema = closed({
  asOf: t.String(),
  facilityDate: t.String(),
  status: OpmStatusSchema,
  nextDay: t.Union([t.String(), t.Null()]),
  decideBy: closed({
    at: t.String(),
    local: t.String(),
    pastDeadline: t.Boolean(),
  }),
  confidence: closed({
    level: t.UnionEnum(CONFIDENCE_LEVELS),
    reasons: t.Array(ConfidenceReasonSchema),
  }),
  findings: t.Array(FindingSchema),
  sensitivity: t.Array(SensitivitySchema),
  rationale: t.String(),
});

/** What a recommendation row stores: everything the engine read and everything it returned. */
const SnapshotSchema = closed({
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

type AssertTrue<Condition extends true> = Condition;

/**
 * Fails to compile when the engine's types and this schema drift in either direction. Mutual
 * assignability would miss an added optional field, so this demands identical types. DeepMutable
 * reads the engine's non-empty tuples as arrays; `minItems` checks those at runtime.
 */
type _SnapshotMirrorsEngine = AssertTrue<
  Equal<
    DeepMutable<{ input: EngineInput; output: Recommendation }>,
    DeepMutable<Snapshot>
  >
>;

export type { Snapshot };
export { RecommendationSchema, SnapshotSchema };
