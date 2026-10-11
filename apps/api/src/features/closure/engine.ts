import {
  type ConfidenceLevel,
  type facilities,
  HAZARDS,
  type Hazard,
} from "@hackmidwest/db";
import type { NwsAlert } from "../../clients/nws-model";
import { type Caveat, caveatsFor, confidenceOf } from "./confidence";
import {
  assessHazard,
  type CheckContext,
  type Crossing,
  crossings,
  type HazardAssessment,
} from "./cutoff-checks";
import type { CutoffName } from "./cutoff-names";
import { mostDisruptive } from "./disruption";
import { currentAlerts } from "./hazard-window";
import { rationale } from "./rationale";
import type { Reading } from "./readings";
import type { ForecastInput, InputRef } from "./samples";
import { type Sensitivity, sensitivityOf } from "./sensitivity";
import {
  type FacilitySchedule,
  facilityDay,
  type IsoInstant,
  type OpmStatus,
  type TimingResult,
} from "./timing";
import { formatDate, localInstant, parseInstant, toIso } from "./zoned-time";

type EngineFacility = FacilitySchedule &
  Pick<typeof facilities.$inferSelect, "decisionDeadline"> & {
    readonly hazardProfile: readonly Hazard[];
  };

interface EngineInput {
  readonly now: IsoInstant;
  readonly facility: EngineFacility;
  readonly readings: readonly Reading[];
  readonly alerts: readonly NwsAlert[];
  readonly forecast: ForecastInput;
}

interface Recommendation {
  readonly status: OpmStatus;
  readonly confidence: ConfidenceLevel;
  readonly caveats: readonly Caveat[];
  readonly facilityDate: string;
  readonly decideBy: IsoInstant;
  readonly hazards: readonly HazardAssessment[];
  readonly driver: {
    readonly hazard: Hazard;
    readonly cutoff: CutoffName;
    readonly timing: TimingResult;
  } | null;
  readonly inputs: readonly InputRef[];
  /** `YYYY-MM-DD` when a crossed hazard starts after today's hours, so that day needs its own call. */
  readonly nextDay: string | null;
  readonly sensitivity: readonly Sensitivity[];
  readonly rationale: string;
}

const NORMAL: OpmStatus = { posture: "normal" };

function evaluatePosture(input: EngineInput): Recommendation {
  const { now, facility } = input;
  const day = facilityDay(facility, parseInstant(now));
  const context: CheckContext = {
    now,
    facilityDayEnd: day.closesAt,
    readings: input.readings,
    forecast: input.forecast,
    facility,
    alertsInForce: currentAlerts(input.alerts),
  };
  const hazards = HAZARDS.filter((hazard) =>
    facility.hazardProfile.includes(hazard),
  ).map((hazard) => assessHazard(hazard, context));
  const crossed = crossings(hazards);
  const driver = mostDisruptive(
    crossed,
    ({ outcome }) => outcome.timing.status,
  );
  const status = driver?.outcome.timing.status ?? NORMAL;
  const inputs = referencedInputs(hazards);
  const caveats = caveatsFor(hazards, inputs, driver?.outcome.timing, now);
  const confidence = confidenceOf(caveats);
  const facilityDate = formatDate(day.date);
  const decideBy = toIso(
    localInstant(day.date, facility.decisionDeadline, facility.timezone),
  );
  return {
    status,
    confidence,
    caveats,
    facilityDate,
    decideBy,
    hazards,
    driver: driverSummary(driver),
    inputs,
    nextDay:
      hazards
        .flatMap(({ checks }) => checks)
        .find(({ nextDay }) => nextDay !== null)?.nextDay ?? null,
    sensitivity: sensitivityOf(crossed, status, { now, facility }),
    rationale: rationale({
      status,
      facilityDate,
      crossings: crossed,
      driver,
      confidence,
      caveats,
      decideBy,
      now,
      zone: facility.timezone,
    }),
  };
}

function driverSummary(driver: Crossing | undefined): Recommendation["driver"] {
  if (driver === undefined) {
    return null;
  }
  return {
    hazard: driver.hazard,
    cutoff: driver.cutoff,
    timing: driver.outcome.timing,
  };
}

function referencedInputs(hazards: readonly HazardAssessment[]): InputRef[] {
  const byKey = new Map<string, InputRef>();
  for (const { checks } of hazards) {
    for (const { outcome } of checks) {
      if (outcome.kind !== "absent") {
        byKey.set(`${outcome.input.kind}:${outcome.input.ref}`, outcome.input);
      }
    }
  }
  return [...byKey.values()];
}

export type { EngineFacility, EngineInput, Recommendation };
export { evaluatePosture };
