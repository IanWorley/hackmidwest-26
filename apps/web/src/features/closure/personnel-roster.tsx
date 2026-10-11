import { type JSX, useId, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { PersonnelTable } from "./personnel-table";
import type { RecordStatus } from "./record-status";
import {
  type Building,
  EFFECTIVE_KINDS,
  type EffectiveKind,
  filterRoster,
  NO_FILTERS,
  type Personnel,
  POSTURE_LABELS,
  type RosterFilters,
  STATUS_LABELS,
  type StatusCount,
} from "./roster-filter";

const FILTERS_NAME = "Filter people";
const SUMMARY_NAME = "Status summary";
const BUILDING_LABEL = "Building";
const STATUS_LABEL = "Effective status";
const ESSENTIAL_LABEL = "Essential";
const ALL_OPTION = "All";
const ANY_VALUE = "";
const SUMMARY_SEPARATOR = " · ";
const NO_MATCHES_TEXT = "Nobody matches these filters.";
const UNTIMED_TITLE = "Effective status can't be resolved";
const ESSENTIAL_OPTIONS = {
  essential: { label: "Essential only", value: true },
  other: { label: "Not essential", value: false },
} as const;

function parseBuilding(
  buildings: readonly Building[],
  value: string,
): number | undefined {
  return buildings.find((building) => String(building.id) === value)?.id;
}

function parseStatus(value: string): EffectiveKind | undefined {
  return EFFECTIVE_KINDS.find((kind) => kind === value);
}

function parseEssential(value: string): boolean | undefined {
  const option = Object.entries(ESSENTIAL_OPTIONS).find(
    ([key]) => key === value,
  );
  return option?.[1].value;
}

function essentialValue(essential: boolean | undefined): string {
  const option = Object.entries(ESSENTIAL_OPTIONS).find(
    ([, { value }]) => value === essential,
  );
  return option?.[0] ?? ANY_VALUE;
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: JSX.Element[];
}): JSX.Element {
  const id = useId();
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        onChange={(event): void => onChange(event.target.value)}
        value={value}
      >
        <NativeSelectOption value={ANY_VALUE}>{ALL_OPTION}</NativeSelectOption>
        {children}
      </NativeSelect>
    </div>
  );
}

function summaryText(counts: readonly StatusCount[]): string {
  if (counts.length === 0) {
    return NO_MATCHES_TEXT;
  }
  return counts
    .map(({ kind, count }) => `${count} ${STATUS_LABELS[kind]}`)
    .join(SUMMARY_SEPARATOR);
}

/** An override with no recorded time cannot resolve anyone, so it replaces the counts. */
function Summary({
  posture,
  counts,
}: {
  posture: Personnel["posture"];
  counts: readonly StatusCount[];
}): JSX.Element {
  if (posture.kind === "untimed") {
    return (
      <Alert>
        <AlertTitle>{UNTIMED_TITLE}</AlertTitle>
        <AlertDescription>
          {`Today's posture is ${POSTURE_LABELS[posture.posture]}, but no time was recorded for it, so effective status can't be resolved.`}
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <section aria-label={SUMMARY_NAME}>
      <p className="font-medium">{summaryText(counts)}</p>
    </section>
  );
}

export function PersonnelRoster({
  personnel,
  timeZone,
  recordStatus,
}: {
  personnel: Personnel;
  timeZone: string;
  recordStatus: RecordStatus;
}): JSX.Element {
  const [filters, setFilters] = useState<RosterFilters>(NO_FILTERS);
  const view = filterRoster(personnel.people, filters);
  return (
    <div className="space-y-4">
      <search aria-label={FILTERS_NAME} className="flex flex-wrap gap-4">
        <FilterSelect
          label={BUILDING_LABEL}
          onChange={(value): void =>
            setFilters({
              ...filters,
              buildingId: parseBuilding(personnel.buildings, value),
            })
          }
          value={String(filters.buildingId ?? ANY_VALUE)}
        >
          {personnel.buildings.map((building) => (
            <NativeSelectOption key={building.id} value={String(building.id)}>
              {building.name}
            </NativeSelectOption>
          ))}
        </FilterSelect>
        {personnel.posture.kind !== "untimed" && (
          <FilterSelect
            label={STATUS_LABEL}
            onChange={(value): void =>
              setFilters({ ...filters, status: parseStatus(value) })
            }
            value={filters.status ?? ANY_VALUE}
          >
            {EFFECTIVE_KINDS.map((kind) => (
              <NativeSelectOption key={kind} value={kind}>
                {STATUS_LABELS[kind]}
              </NativeSelectOption>
            ))}
          </FilterSelect>
        )}
        <FilterSelect
          label={ESSENTIAL_LABEL}
          onChange={(value): void =>
            setFilters({ ...filters, essential: parseEssential(value) })
          }
          value={essentialValue(filters.essential)}
        >
          {Object.entries(ESSENTIAL_OPTIONS).map(([value, { label }]) => (
            <NativeSelectOption key={value} value={value}>
              {label}
            </NativeSelectOption>
          ))}
        </FilterSelect>
      </search>
      <Summary counts={view.counts} posture={personnel.posture} />
      <PersonnelTable
        buildings={personnel.buildings}
        people={view.people}
        recorders={personnel.recorders}
        recordStatus={recordStatus}
        timeZone={timeZone}
      />
    </div>
  );
}
