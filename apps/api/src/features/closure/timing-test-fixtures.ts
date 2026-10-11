import type { HazardEvidence } from "./hazard-window";
import type { FacilitySchedule, TimingInput } from "./timing";

// 2026-01-14 is CST (UTC-6): arrival opens 13:00Z and the facility closes at 22:30Z.
const FACILITY: FacilitySchedule = {
  timezone: "America/Chicago",
  opensAt: "07:30",
  closesAt: "16:30",
  arrivalWindowStart: "07:00",
  arrivalWindowEnd: "09:00",
  typicalCommuteMinutes: 35,
  roadClass: "urbanCommuter",
};
const NOW = "2026-01-14T09:00:00Z";

type Period = HazardEvidence["exceedingPeriods"][number];

function period(startTime: string, endTime: string): Period {
  return { startTime, endTime };
}

function alert(
  start: string,
  end: string,
  endBasis: "ends" | "expires" = "ends",
  exceedingPeriods: readonly Period[] = [],
): HazardEvidence {
  return {
    source: "alert",
    window: { start, end, endBasis },
    exceedingPeriods,
  };
}

function timing(overrides: Partial<TimingInput>): TimingInput {
  return {
    now: NOW,
    facility: FACILITY,
    hazard: "winter",
    crossedPosture: "full_closure",
    evidence: alert("2026-01-14T06:00:00Z", "2026-01-14T11:00:00Z"),
    ...overrides,
  };
}

export { alert, FACILITY, period, timing };
