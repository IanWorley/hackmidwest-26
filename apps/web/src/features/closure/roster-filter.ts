import type { loadFacilityPersonnel } from "./load-facilities";

function matches(person: Person, filters: RosterFilters): boolean {
  return (
    (filters.buildingId === undefined ||
      person.buildingId === filters.buildingId) &&
    (filters.essential === undefined ||
      person.essentialPersonnel === filters.essential) &&
    (filters.status === undefined ||
      effectiveOf(person)?.kind === filters.status)
  );
}

export type Personnel = Awaited<
  ReturnType<typeof loadFacilityPersonnel>
>["personnel"];
export type Person = Personnel["people"][number];
export type ResolvedPerson = Extract<Person, { effective: unknown }>;
export type EffectiveStatus = ResolvedPerson["effective"];
export type EffectiveKind = EffectiveStatus["kind"];
export type Building = Personnel["buildings"][number];
export type Recorder = Personnel["recorders"][number];
export type FacilityPosture = Extract<
  EffectiveStatus["cause"],
  { source: "posture" }
>["posture"];

/** Summary and filter order: working states first, then the ones that keep people away. */
export const EFFECTIVE_KINDS = [
  "working_onsite",
  "teleworking",
  "delayed_arrival",
  "report_required",
  "dismissed",
  "not_working",
] as const satisfies readonly EffectiveKind[];

export const STATUS_LABELS: Record<EffectiveKind, string> = {
  working_onsite: "onsite",
  teleworking: "teleworking",
  delayed_arrival: "delayed arrival",
  report_required: "report required",
  dismissed: "dismissed",
  not_working: "not working",
};

export const POSTURE_LABELS: Record<FacilityPosture, string> = {
  normal: "normal operations",
  delayed_arrival: "delayed arrival",
  early_dismissal: "early dismissal",
  unscheduled_telework: "unscheduled telework",
  full_closure: "full closure",
};

/** `undefined` means the filter is off. */
export interface RosterFilters {
  readonly buildingId: number | undefined;
  readonly status: EffectiveKind | undefined;
  readonly essential: boolean | undefined;
}

export const NO_FILTERS: RosterFilters = {
  buildingId: undefined,
  status: undefined,
  essential: undefined,
};

export interface StatusCount {
  readonly kind: EffectiveKind;
  readonly count: number;
}

export interface RosterView {
  readonly people: readonly Person[];
  /** Only the statuses someone in `people` holds, in `EFFECTIVE_KINDS` order. */
  readonly counts: readonly StatusCount[];
}

/** An untimed posture leaves everyone unresolved, so they have no effective status. */
export function effectiveOf(person: Person): EffectiveStatus | undefined {
  if ("effective" in person) {
    return person.effective;
  }
  return undefined;
}

/** The table and the summary both read this, so the counts always describe the rows shown. */
export function filterRoster(
  people: readonly Person[],
  filters: RosterFilters,
): RosterView {
  const shown = people.filter((person) => matches(person, filters));
  const counts = EFFECTIVE_KINDS.map((kind) => ({
    kind,
    count: shown.filter((person) => effectiveOf(person)?.kind === kind).length,
  })).filter(({ count }) => count > 0);
  return { people: shown, counts };
}
