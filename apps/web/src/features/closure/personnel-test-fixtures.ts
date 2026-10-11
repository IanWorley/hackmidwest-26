import type {
  EffectiveStatus,
  Personnel,
  ResolvedPerson,
} from "./roster-filter";

const ONSITE_BASELINE = { status: "working_onsite", event: null } as const;

export const CHICAGO = "America/Chicago";
export const MAIN_OFFICE = { id: 1, name: "Main Office" };
export const ANNEX = { id: 2, name: "Annex" };

export const ONSITE: EffectiveStatus = {
  kind: "working_onsite",
  cause: { source: "baseline", baseline: ONSITE_BASELINE },
};
export const TELEWORKING: EffectiveStatus = {
  kind: "teleworking",
  cause: { source: "posture", posture: "unscheduled_telework" },
};
export const DISMISSED_ALL_DAY: EffectiveStatus = {
  kind: "dismissed",
  release: "all_day",
  cause: { source: "posture", posture: "full_closure" },
};
export const ON_LEAVE: EffectiveStatus = {
  kind: "not_working",
  note: "Annual leave",
  cause: { source: "posture", posture: "full_closure" },
};

export function resolvedPerson(
  employeeId: number,
  name: string,
  {
    building,
    essential,
    effective,
  }: {
    building: { id: number };
    essential: boolean;
    effective: EffectiveStatus;
  },
): ResolvedPerson {
  return {
    employeeId,
    name,
    buildingId: building.id,
    essentialPersonnel: essential,
    teleworkEligible: true,
    email: `employee${employeeId}@usda.example`,
    mobilePhone: null,
    preferredChannel: "email",
    hasAccessibilityNeeds: false,
    baseline: ONSITE_BASELINE,
    latestEvent: null,
    effective,
  };
}

export function personnel(people: ResolvedPerson[]): Personnel {
  return {
    facilityId: 1,
    facilityDate: "2026-01-14",
    asOf: "2026-01-14T15:00:00.000Z",
    decision: null,
    buildings: [MAIN_OFFICE, ANNEX],
    recorders: [
      { id: 1, name: "Dana Whitfield", role: "County Executive Director" },
    ],
    posture: { kind: "none" },
    people,
  };
}
