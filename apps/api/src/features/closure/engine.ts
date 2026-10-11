import {
  type ConfidenceLevel,
  facilities,
  HAZARDS,
  POSTURES,
} from "@hackmidwest/db";
import { createSchemaFactory } from "drizzle-typebox";
import { type Static, t } from "elysia";
import { ForecastPeriodSchema, NwsAlertSchema } from "../../clients/nws-model";
import { type Exceedance, matchCutoffs, toEvidence } from "./exceedances";
import { type InputKind, staleInputs } from "./freshness";
import type { EndBasis } from "./hazard-window";
import { type Reading, ReadingSchema } from "./readings";
import {
  type ConfidenceReason,
  type Finding,
  type Recommendation,
  rationale,
  type Sensitivity,
} from "./recommendation";
import { normalize, shiftSignals } from "./signals";
import { type Cutoff, THRESHOLDS } from "./thresholds";
import {
  evaluateTiming,
  facilityDate,
  type OpmStatus,
  type TimingResult,
} from "./timing";
import { TIMING_POLICY } from "./timing-policy";
import {
  type CalendarDate,
  formatDate,
  type Instant,
  localInstant,
  parseInstant,
  toIso,
} from "./zoned-time";

const { createSelectSchema } = createSchemaFactory({ typeboxInstance: t });
const facilityColumns = createSelectSchema(facilities).properties;

/** Plain JSON with ISO-8601 instants, so a stored input replays through `Value.Parse`. */
const EngineInputSchema = t.Object({
  /** The evaluation instant. The engine never reads the clock. */
  now: t.String(),
  facility: t.Object({
    timezone: facilityColumns.timezone,
    opensAt: facilityColumns.opensAt,
    closesAt: facilityColumns.closesAt,
    arrivalWindowStart: facilityColumns.arrivalWindowStart,
    arrivalWindowEnd: facilityColumns.arrivalWindowEnd,
    typicalCommuteMinutes: facilityColumns.typicalCommuteMinutes,
    roadClass: facilityColumns.roadClass,
    decisionDeadline: facilityColumns.decisionDeadline,
    hazards: t.Array(t.UnionEnum(HAZARDS)),
  }),
  alerts: t.Object({ asOf: t.String(), items: t.Array(NwsAlertSchema) }),
  readings: t.Array(ReadingSchema),
  forecast: t.Union([
    t.Object({
      asOf: t.String(),
      rawRef: t.String(),
      periods: t.Array(ForecastPeriodSchema),
    }),
    t.Null(),
  ]),
});

type EngineInput = Static<typeof EngineInputSchema>;
type EndStrength = "firm" | "estimated" | "none";
type InputHealth = "fresh" | "degraded";

const NORMAL: OpmStatus = { posture: "normal" };

const END_STRENGTH = {
  ends: "firm",
  expires: "estimated",
  forecast: "estimated",
} as const satisfies Record<EndBasis, EndStrength>;

const CONFIDENCE = {
  firm: { fresh: "high", degraded: "medium" },
  estimated: { fresh: "medium", degraded: "low" },
  none: { fresh: "high", degraded: "low" },
} as const satisfies Record<EndStrength, Record<InputHealth, ConfidenceLevel>>;

function evaluatePosture(input: EngineInput): Recommendation {
  const now = parseInstant(input.now);
  const day = facilityDate(input.facility, now);
  const findings = matchCutoffs(input.facility.hazards, normalize(input))
    .map((exceedance) => ({ ...exceedance, timing: timing(input, exceedance) }))
    .sort((a, b) => disruption(b.timing.status, a.timing.status));
  const [deciding, ...others] = findings;
  const parts = {
    asOf: input.now,
    facilityDate: formatDate(day),
    status: deciding?.timing.status ?? NORMAL,
    nextDay: nextDay(findings),
    decideBy: decideBy(input.facility, day, now),
    confidence: confidence(input, deciding),
    findings,
    sensitivity: sensitivity(input, deciding, others),
  };
  return { ...parts, rationale: rationale(parts) };
}

function timing(input: EngineInput, exceedance: Exceedance): TimingResult {
  return evaluateTiming({
    now: input.now,
    facility: input.facility,
    hazard: exceedance.hazard,
    crossedPosture: exceedance.cutoff.posture,
    evidence: toEvidence(exceedance.signals),
  });
}

/** Posture order first; within a posture, a longer delay or an earlier release is more disruptive. */
function disruption(a: OpmStatus, b: OpmStatus): number {
  return (
    POSTURES.indexOf(a.posture) - POSTURES.indexOf(b.posture) ||
    withinPosture(a) - withinPosture(b)
  );
}

function withinPosture(status: OpmStatus): number {
  switch (status.posture) {
    case "delayed_arrival":
      return status.delayHours;
    case "early_dismissal":
      return -parseInstant(status.departAt);
    case "normal":
    case "unscheduled_telework":
    case "full_closure":
      return 0;
    default:
      return status satisfies never;
  }
}

function moreDisruptive(most: OpmStatus, status: OpmStatus): OpmStatus {
  if (disruption(status, most) > 0) {
    return status;
  }
  return most;
}

function nextDay(findings: readonly Finding[]): string | null {
  for (const { timing: result } of findings) {
    if (result.timingCase.kind === "startsAfterHours") {
      return result.timingCase.nextDay;
    }
  }
  return null;
}

function decideBy(
  facility: EngineInput["facility"],
  day: CalendarDate,
  now: Instant,
): Recommendation["decideBy"] {
  const at = localInstant(day, facility.decisionDeadline, facility.timezone);
  return {
    at: toIso(at),
    local: facility.decisionDeadline,
    pastDeadline: now > at,
  };
}

function confidence(
  input: EngineInput,
  deciding: Finding | undefined,
): Recommendation["confidence"] {
  const inputReasons = inputHealth(input);
  let health: InputHealth = "degraded";
  if (inputReasons.length === 0) {
    health = "fresh";
  }
  if (deciding === undefined) {
    return { level: CONFIDENCE.none[health], reasons: inputReasons };
  }
  const { endBasis } = deciding.timing.hazardWindow;
  const strength = END_STRENGTH[endBasis];
  if (strength === "estimated") {
    return {
      level: CONFIDENCE.estimated[health],
      reasons: [{ kind: "endBasis", endBasis }, ...inputReasons],
    };
  }
  return { level: CONFIDENCE[strength][health], reasons: inputReasons };
}

/** Stale or missing inputs among those the profiled hazards' cutoffs read. */
function inputHealth(input: EngineInput): ConfidenceReason[] {
  const required = new Set(
    input.facility.hazards.flatMap((hazard) =>
      Object.values<Cutoff>(THRESHOLDS[hazard].cutoffs).flatMap((cutoff) =>
        unitInputs(cutoff.unit),
      ),
    ),
  );
  const stamps: { readonly input: InputKind; readonly asOf: string }[] =
    input.readings.map((reading) => ({
      input: readingInput(reading.source),
      asOf: reading.observedAt,
    }));
  if (input.forecast !== null) {
    stamps.push({ input: "forecast", asOf: input.forecast.asOf });
  }
  return [...required].flatMap((kind): ConfidenceReason[] => {
    const [latest] = stamps
      .filter((stamp) => stamp.input === kind)
      .sort((a, b) => parseInstant(b.asOf) - parseInstant(a.asOf));
    if (latest === undefined) {
      return [{ kind: "missing", input: kind }];
    }
    return staleInputs([latest], input.now).map((stale) => ({
      kind: "stale",
      ...stale,
    }));
  });
}

function sensitivity(
  input: EngineInput,
  deciding: Finding | undefined,
  others: readonly Finding[],
): Sensitivity[] {
  if (deciding === undefined) {
    return [];
  }
  const shift = TIMING_POLICY.sensitivityShiftMinutes.value;
  const otherStatuses = others.map((finding) => finding.timing.status);
  const onsetShifts = [-shift, shift].map(
    (shiftMinutes): Sensitivity => ({
      kind: "onsetShift",
      shiftMinutes,
      status: otherStatuses.reduce(
        moreDisruptive,
        timing(input, {
          ...deciding,
          signals: shiftSignals(deciding.signals, shiftMinutes),
        }).status,
      ),
    }),
  );
  const without = otherStatuses[0] ?? NORMAL;
  if (disruption(without, deciding.timing.status) === 0) {
    return onsetShifts;
  }
  const { hazard, cutoffId, margin } = deciding;
  return [
    ...onsetShifts,
    { kind: "withoutFinding", hazard, cutoffId, margin, status: without },
  ];
}

/** The inputs a cutoff unit is read from. Alerts are always present by type. */
function unitInputs(unit: Cutoff["unit"]): readonly InputKind[] {
  switch (unit) {
    case "nws_severity":
      return [];
    case "mph":
      return ["observations", "forecast"];
    case "aqi":
      return ["airQuality"];
    // No input carries a river stage yet.
    case "nws_flood_category":
      return [];
    default:
      return unit satisfies never;
  }
}

function readingInput(source: Reading["source"]): InputKind {
  switch (source) {
    case "nws":
      return "observations";
    case "open-meteo":
      return "airQuality";
    default:
      return source satisfies never;
  }
}

export type { Recommendation } from "./recommendation";
export type { EngineInput };
export { EngineInputSchema, evaluatePosture };
