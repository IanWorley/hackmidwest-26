import type { facilities, Hazard } from "@hackmidwest/db";
import {
  type EndBasis,
  type HazardEvidence,
  type HazardInterval,
  hazardInterval,
} from "./hazard-window";
import type { Posture } from "./postures";
import { THRESHOLDS, TIMING_POLICY } from "./thresholds";
import {
  addDays,
  type CalendarDate,
  calendarDate,
  formatDate,
  formatTimeOfDay,
  type Instant,
  localInstant,
  MS_PER_MINUTE,
  parseInstant,
  toInstant,
  toIso,
} from "./zoned-time";

const MS_PER_HOUR = 3_600_000;

/** ISO-8601 instant, as produced by `Date#toISOString`. */
type IsoInstant = string;

/** Exactly the facility columns timing reads; the engine passes the row unchanged. */
type FacilitySchedule = Pick<
  typeof facilities.$inferSelect,
  | "timezone"
  | "opensAt"
  | "closesAt"
  | "arrivalWindowStart"
  | "arrivalWindowEnd"
  | "typicalCommuteMinutes"
  | "notificationLeadMinutes"
>;

interface TimingInput {
  readonly now: IsoInstant;
  readonly facility: FacilitySchedule;
  readonly hazard: Hazard;
  /** The posture of the cutoff the engine found crossed. Picks telework or closure for long hazards. */
  readonly crossedPosture: Exclude<Posture, "normal">;
  readonly evidence: HazardEvidence;
}

/** One variant per §5.1 row. */
type TimingCase =
  | { readonly kind: "clearsBeforeArrival" }
  | { readonly kind: "delayWithinCap"; readonly delayHours: number }
  | { readonly kind: "outlastsDelayCap"; readonly delayHours: number }
  | { readonly kind: "startsDuringHours"; readonly releaseAt: IsoInstant }
  | { readonly kind: "spansOperatingDay" }
  | { readonly kind: "startsAfterHours"; readonly nextDay: string };

/** Announced the way OPM does: a delay as an hour count, a dismissal as a departure time. */
type OpmStatus =
  | { readonly posture: "normal" }
  | { readonly posture: "delayed_arrival"; readonly delayHours: number }
  | {
      readonly posture: "early_dismissal";
      readonly departAt: IsoInstant;
      /** `HH:MM` on the facility's wall clock. */
      readonly departAtLocal: string;
    }
  | { readonly posture: "unscheduled_telework" }
  | { readonly posture: "full_closure" };

type DecisionDeadline =
  | {
      readonly kind: "open";
      readonly decideBy: IsoInstant;
      readonly minutesLeft: number;
    }
  | {
      readonly kind: "passed";
      readonly decideBy: IsoInstant;
      readonly minutesLate: number;
    };

interface TimingResult {
  /** `YYYY-MM-DD` in the facility's zone. */
  readonly facilityDate: string;
  readonly hazardWindow: {
    readonly start: IsoInstant;
    readonly end: IsoInstant;
    /** `expires` or `forecast` is a weaker end estimate than `ends` and lowers confidence. */
    readonly endBasis: EndBasis;
    readonly clearsAt: IsoInstant;
  };
  readonly timingCase: TimingCase;
  readonly status: OpmStatus;
  readonly deadline: DecisionDeadline;
}

interface FacilityDay {
  readonly date: CalendarDate;
  readonly opensAt: Instant;
  readonly closesAt: Instant;
  readonly arrivalStart: Instant;
  readonly arrivalEnd: Instant;
}

function evaluateTiming(input: TimingInput): TimingResult {
  const now = parseInstant(input.now);
  const zone = input.facility.timezone;
  const day = facilityDay(input.facility, now);
  const hazard = hazardInterval(input.evidence, input.hazard);
  const timingCase = classify(hazard, day, input.facility, input.hazard);
  // An early dismissal is announced against its release time, everything else against arrival.
  let actionAt = day.arrivalStart;
  if (timingCase.kind === "startsDuringHours") {
    actionAt = parseInstant(timingCase.releaseAt);
  }
  return {
    facilityDate: formatDate(day.date),
    hazardWindow: {
      start: toIso(hazard.start),
      end: toIso(hazard.end),
      endBasis: hazard.endBasis,
      clearsAt: toIso(hazard.clearsAt),
    },
    timingCase,
    status: toStatus(timingCase, input.crossedPosture, zone),
    deadline: deadline(actionAt, input.facility, now),
  };
}

/** Check order is precedence: a hazard active when the arrival window opens is never an early dismissal. */
function classify(
  hazard: HazardInterval,
  day: FacilityDay,
  facility: FacilitySchedule,
  hazardKind: Hazard,
): TimingCase {
  if (hazard.clearsAt <= day.arrivalStart) {
    return { kind: "clearsBeforeArrival" };
  }
  if (hazard.start >= day.closesAt) {
    return {
      kind: "startsAfterHours",
      nextDay: formatDate(addDays(day.date, 1)),
    };
  }
  if (hazard.start < day.arrivalEnd) {
    const delayHours =
      roundUp(
        hazard.clearsAt - day.arrivalStart,
        TIMING_POLICY.delayIncrementMinutes.value * MS_PER_MINUTE,
      ) / MS_PER_HOUR;
    if (delayHours <= THRESHOLDS[hazardKind].maxDelayHours.value) {
      return { kind: "delayWithinCap", delayHours };
    }
    if (hazard.clearsAt >= day.closesAt) {
      return { kind: "spansOperatingDay" };
    }
    return { kind: "outlastsDelayCap", delayHours };
  }
  // Rounding epoch ms to the quarter hour is local-time rounding only in zones whose offset is a
  // whole quarter hour, which every US zone is.
  const releaseAt = roundDown(
    hazard.start -
      (facility.typicalCommuteMinutes +
        TIMING_POLICY.dismissalMarginMinutes.value) *
        MS_PER_MINUTE,
    TIMING_POLICY.releaseIncrementMinutes.value * MS_PER_MINUTE,
  );
  if (releaseAt > day.opensAt) {
    return { kind: "startsDuringHours", releaseAt: toIso(releaseAt) };
  }
  return { kind: "spansOperatingDay" };
}

function toStatus(
  timingCase: TimingCase,
  crossedPosture: Exclude<Posture, "normal">,
  zone: string,
): OpmStatus {
  switch (timingCase.kind) {
    case "clearsBeforeArrival":
    case "startsAfterHours":
      return { posture: "normal" };
    case "delayWithinCap":
      return {
        posture: "delayed_arrival",
        delayHours: timingCase.delayHours,
      };
    case "startsDuringHours":
      return {
        posture: "early_dismissal",
        departAt: timingCase.releaseAt,
        departAtLocal: formatTimeOfDay(
          parseInstant(timingCase.releaseAt),
          zone,
        ),
      };
    case "outlastsDelayCap":
    case "spansOperatingDay":
      if (crossedPosture === "full_closure") {
        return { posture: "full_closure" };
      }
      return { posture: "unscheduled_telework" };
    default:
      return timingCase satisfies never;
  }
}

function deadline(
  actionAt: Instant,
  facility: FacilitySchedule,
  now: Instant,
): DecisionDeadline {
  const decideBy = toInstant(
    actionAt -
      (facility.notificationLeadMinutes +
        TIMING_POLICY.notificationDeliveryMinutes.value) *
        MS_PER_MINUTE,
  );
  if (now > decideBy) {
    return {
      kind: "passed",
      decideBy: toIso(decideBy),
      minutesLate: Math.floor((now - decideBy) / MS_PER_MINUTE),
    };
  }
  return {
    kind: "open",
    decideBy: toIso(decideBy),
    minutesLeft: Math.floor((decideBy - now) / MS_PER_MINUTE),
  };
}

/**
 * The facility day a decision made at `now` is about: today in the facility's zone until today's
 * closing time, then tomorrow. Weekends and holidays are not modeled.
 */
function facilityDay(facility: FacilitySchedule, now: Instant): FacilityDay {
  const zone = facility.timezone;
  const today = calendarDate(now, zone);
  let date = today;
  if (now >= localInstant(today, facility.closesAt, zone)) {
    date = addDays(today, 1);
  }
  return {
    date,
    opensAt: localInstant(date, facility.opensAt, zone),
    closesAt: localInstant(date, facility.closesAt, zone),
    arrivalStart: localInstant(date, facility.arrivalWindowStart, zone),
    arrivalEnd: localInstant(date, facility.arrivalWindowEnd, zone),
  };
}

function roundUp(value: number, increment: number): number {
  return Math.ceil(value / increment) * increment;
}

function roundDown(value: number, increment: number): Instant {
  return toInstant(Math.floor(value / increment) * increment);
}

export type {
  DecisionDeadline,
  FacilitySchedule,
  OpmStatus,
  TimingCase,
  TimingInput,
  TimingResult,
};
export { evaluateTiming };
