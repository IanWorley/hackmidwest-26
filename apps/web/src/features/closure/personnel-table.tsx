import type { JSX } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RecordStatus } from "./record-status";
import {
  type Building,
  effectiveOf,
  type Person,
  type Recorder,
  STATUS_LABELS,
} from "./roster-filter";
import { UpdateStatusDialog } from "./status-form";
import { formatScheduled, formatStatusReason } from "./status-reason";

const TABLE_NAME = "People";
const COLUMNS = [
  "Name",
  "Building",
  "Essential",
  "Baseline",
  "Effective status",
  "Contact",
  "Accessibility",
] as const;
const YES_TEXT = "Yes";
const NO_TEXT = "No";
const UNRESOLVED_TEXT = "Not resolved";
const UNKNOWN_BUILDING_TEXT = "Unknown building";
const NO_PHONE_TEXT = "No mobile phone";
// Notes and reasons are free text, so they wrap instead of widening the table.
const WRAPPING_CELL = "min-w-32 space-y-1 whitespace-normal";
const EMPTY_TEXT = "No people match these filters.";
const CHANNEL_LABELS: Record<Person["preferredChannel"], string> = {
  email: "Prefers email",
  sms: "Prefers text message",
};

function pick(condition: boolean, yes: string, no: string): string {
  if (condition) {
    return yes;
  }
  return no;
}

function baselineText(baseline: Person["baseline"]): string {
  const label = STATUS_LABELS[baseline.status];
  if (baseline.status === "not_working") {
    return `${label}, ${baseline.note}`;
  }
  return label;
}

function ScheduledStatus({
  person,
  timeZone,
}: {
  person: Person;
  timeZone: string;
}): JSX.Element | null {
  const scheduled = formatScheduled(person, timeZone);
  if (scheduled === undefined) {
    return null;
  }
  return <p className="text-muted-foreground text-sm">{scheduled}</p>;
}

function effectiveText(person: Person, timeZone: string): string {
  const effective = effectiveOf(person);
  if (effective === undefined) {
    return UNRESOLVED_TEXT;
  }
  return formatStatusReason(effective, timeZone);
}

function PersonRow({
  person,
  buildingNames,
  timeZone,
  recorders,
  recordStatus,
}: {
  person: Person;
  buildingNames: ReadonlyMap<number, string>;
  timeZone: string;
  recorders: readonly Recorder[];
  recordStatus: RecordStatus;
}): JSX.Element {
  return (
    <TableRow>
      <TableCell className="font-medium">{person.name}</TableCell>
      <TableCell>
        {buildingNames.get(person.buildingId) ?? UNKNOWN_BUILDING_TEXT}
      </TableCell>
      <TableCell>
        {pick(person.essentialPersonnel, YES_TEXT, NO_TEXT)}
      </TableCell>
      <TableCell className={WRAPPING_CELL}>
        <p>{baselineText(person.baseline)}</p>
        <ScheduledStatus person={person} timeZone={timeZone} />
      </TableCell>
      <TableCell className={WRAPPING_CELL}>
        <p>{effectiveText(person, timeZone)}</p>
        <UpdateStatusDialog
          person={person}
          recorders={recorders}
          recordStatus={recordStatus}
        />
      </TableCell>
      <TableCell>
        <div>{CHANNEL_LABELS[person.preferredChannel]}</div>
        <div>{person.email}</div>
        <div>{person.mobilePhone ?? NO_PHONE_TEXT}</div>
      </TableCell>
      <TableCell>
        {pick(person.hasAccessibilityNeeds, YES_TEXT, NO_TEXT)}
      </TableCell>
    </TableRow>
  );
}

function EmptyRow(): JSX.Element {
  return (
    <TableRow>
      <TableCell colSpan={COLUMNS.length}>{EMPTY_TEXT}</TableCell>
    </TableRow>
  );
}

export function PersonnelTable({
  people,
  buildings,
  timeZone,
  recorders,
  recordStatus,
}: {
  people: readonly Person[];
  buildings: readonly Building[];
  timeZone: string;
  recorders: readonly Recorder[];
  recordStatus: RecordStatus;
}): JSX.Element {
  const buildingNames = new Map(
    buildings.map((building) => [building.id, building.name]),
  );
  return (
    <Table aria-label={TABLE_NAME}>
      <TableHeader>
        <TableRow>
          {COLUMNS.map((column) => (
            <TableHead key={column}>{column}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {people.map((person) => (
          <PersonRow
            buildingNames={buildingNames}
            key={person.employeeId}
            person={person}
            recorders={recorders}
            recordStatus={recordStatus}
            timeZone={timeZone}
          />
        ))}
        {people.length === 0 && <EmptyRow />}
      </TableBody>
    </Table>
  );
}
