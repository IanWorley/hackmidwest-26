import { fireEvent, render, screen, within } from "@testing-library/react";
import type { JSX } from "react";
import { expect, it } from "vitest";
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
import type { Building, EffectiveStatus, Personnel } from "./roster-filter";

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

function recorded(): Promise<RecordOutcome> {
  return Promise.resolve({ kind: "recorded" });
}

function roster(personnelData: Personnel): JSX.Element {
  return (
    <PersonnelRoster
      personnel={personnelData}
      recordStatus={recorded}
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
