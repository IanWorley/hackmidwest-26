import { fireEvent, render, screen, within } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { PersonnelRoster } from "./personnel-roster";
import {
  ANNEX,
  CHICAGO,
  DISMISSED_ALL_DAY,
  MAIN_OFFICE,
  ON_LEAVE,
  ONSITE,
  personnel,
  resolvedPerson,
  TELEWORKING,
} from "./personnel-test-fixtures";
import type { RecordOutcome } from "./record-status";
import type {
  Building,
  EffectiveStatus,
  Personnel,
  ResolvedPerson,
} from "./roster-filter";

type RosterEntry = [
  name: string,
  building: Building,
  essential: boolean,
  effective: EffectiveStatus,
];

const ENTRIES: RosterEntry[] = [
  ["Avery Calloway", MAIN_OFFICE, false, ONSITE],
  ["Bianca Ferraro", MAIN_OFFICE, true, ONSITE],
  ["Chen Okafor", ANNEX, true, ONSITE],
  ["Delia Marsh", ANNEX, false, TELEWORKING],
  ["Eli Brandt", MAIN_OFFICE, false, DISMISSED_ALL_DAY],
  ["Farah Quinn", ANNEX, false, ON_LEAVE],
];

const PEOPLE = ENTRIES.map(([name, building, essential, effective], index) =>
  resolvedPerson(index + 1, name, { building, essential, effective }),
);
const ROSTER = personnel(PEOPLE);
const AS_OF_MS = Date.parse(ROSTER.asOf);
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
/** Closing time, an hour after the roster was read, so a scheduled event a minute out comes first. */
const ROLLS_OVER_AT = new Date(AS_OF_MS + HOUR_MS).toISOString();

afterEach(() => {
  vi.useRealTimers();
});

function reloadNothing(): Promise<void> {
  return Promise.resolve();
}

function recorded(): Promise<RecordOutcome> {
  return Promise.resolve({ kind: "recorded" });
}

function roster(
  personnelData: Personnel,
  onReload: () => Promise<void> = reloadNothing,
): JSX.Element {
  return (
    <PersonnelRoster
      onReload={onReload}
      personnel={personnelData}
      recordStatus={recorded}
      rollsOverAt={ROLLS_OVER_AT}
      timeZone={CHICAGO}
    />
  );
}

function renderRoster(): void {
  render(roster(ROSTER));
}

function summary(): string | null {
  return screen.getByRole("region", { name: "Status summary" }).textContent;
}

function shownNames(): (string | null)[] {
  const rows = within(screen.getByRole("table", { name: "People" }))
    .getAllByRole("row")
    .slice(1);
  return rows.map(
    (row) => within(row).getAllByRole("cell")[0]?.textContent ?? null,
  );
}

it("counts people per effective status", () => {
  renderRoster();

  expect(summary()).toBe(
    "3 onsite · 1 teleworking · 1 dismissed · 1 not working",
  );
});

it("narrows the table and the summary to the chosen building and essential flag", () => {
  renderRoster();

  fireEvent.change(screen.getByRole("combobox", { name: "Building" }), {
    target: { value: String(ANNEX.id) },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Essential" }), {
    target: { value: "other" },
  });

  expect(shownNames()).toEqual(["Delia Marsh", "Farah Quinn"]);
  expect(summary()).toBe("1 teleworking · 1 not working");
});

it("shows everyone when a reload turns untimed while a status filter is chosen", () => {
  const { rerender } = render(roster(ROSTER));
  fireEvent.change(screen.getByRole("combobox", { name: "Effective status" }), {
    target: { value: "teleworking" },
  });
  const untimed: Personnel = {
    ...ROSTER,
    posture: { kind: "untimed", posture: "early_dismissal" },
    people: PEOPLE.map(({ effective: _effective, ...person }) => person),
  };

  rerender(roster(untimed));

  expect(shownNames()).toEqual(ENTRIES.map(([name]) => name));
});

it("names the facility day in the untimed alert", () => {
  render(
    roster({
      ...ROSTER,
      facilityDate: "2026-01-15",
      posture: { kind: "untimed", posture: "early_dismissal" },
      people: PEOPLE.map(({ effective: _effective, ...person }) => person),
    }),
  );

  expect(
    screen.getByText(
      "The posture for Thu, Jan 15 is early dismissal, but no time was recorded for it, so effective status can't be resolved.",
    ),
  ).toBeDefined();
});

it("reloads when a scheduled status takes effect before closing time", () => {
  vi.useFakeTimers({ now: AS_OF_MS });
  const onReload = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const effectiveFrom = new Date(AS_OF_MS + MINUTE_MS).toISOString();
  const scheduled: ResolvedPerson = {
    ...resolvedPerson(1, "Avery Calloway", {
      building: MAIN_OFFICE,
      essential: false,
      effective: ONSITE,
    }),
    nextEvent: {
      id: 1,
      employeeId: 1,
      status: "teleworking",
      note: null,
      reportedById: 1,
      reportedAt: ROSTER.asOf,
      effectiveFrom,
    },
  };
  render(roster(personnel([scheduled]), onReload));

  vi.advanceTimersByTime(MINUTE_MS - 1);
  expect(onReload).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(onReload).toHaveBeenCalledTimes(1);
});
