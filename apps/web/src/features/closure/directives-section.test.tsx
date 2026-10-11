import {
  fireEvent,
  type RenderResult,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { expect, it, vi } from "vitest";
import {
  ANNEX_DISMISSAL,
  KANSAS_CITY_ACCEPT,
} from "../../../test/decision-fixture";
import type {
  Building,
  DirectiveOutcome,
  DirectiveRequest,
} from "./decision-api";
import { DirectivesSection } from "./directives-section";

const BUILDINGS: Building[] = [
  {
    id: 2,
    name: "Annex",
    employees: [{ id: 8, name: "Hana Kowalczyk" }],
  },
];

const RECORDERS = [
  { id: 1, name: "Dana Whitfield", role: "County Executive Director" },
];

function renderSection(
  outcome: DirectiveOutcome = { kind: "issued" },
): ReturnType<
  typeof vi.fn<(request: DirectiveRequest) => Promise<DirectiveOutcome>>
> {
  const submitDirective = vi.fn<
    (request: DirectiveRequest) => Promise<DirectiveOutcome>
  >(() => Promise.resolve(outcome));
  render(
    <DirectivesSection
      {...STANDING}
      buildings={BUILDINGS}
      directives={[]}
      onReload={reloadNothing}
      recorders={RECORDERS}
      submitDirective={submitDirective}
      timeZone="America/Chicago"
    />,
  );
  return submitDirective;
}

const STANDING = {
  decision: KANSAS_CITY_ACCEPT,
  posture: "delayed_arrival",
  isOnShownRecommendation: true,
  isDispatched: false,
} as const;

function sectionProps(
  overrides: Partial<ComponentProps<typeof DirectivesSection>> = {},
): ComponentProps<typeof DirectivesSection> {
  return {
    ...STANDING,
    buildings: BUILDINGS,
    directives: [],
    onReload: reloadNothing,
    recorders: RECORDERS,
    submitDirective: () => Promise.resolve({ kind: "issued" }),
    timeZone: "America/Chicago",
    ...overrides,
  };
}

function reloadNothing(): Promise<void> {
  return Promise.resolve();
}

function choose(label: string, value: string): void {
  fireEvent.change(screen.getByRole("combobox", { name: label }), {
    target: { value },
  });
}

it("issues an employee directive with its reason and recorder", async () => {
  const submitDirective = vi.fn<
    (request: DirectiveRequest) => Promise<DirectiveOutcome>
  >(() => Promise.resolve({ kind: "issued" }));
  const onReload = vi.fn<() => Promise<void>>(() => Promise.resolve());
  render(
    <DirectivesSection
      {...STANDING}
      buildings={BUILDINGS}
      directives={[]}
      onReload={onReload}
      recorders={[
        { id: 1, name: "Dana Whitfield", role: "County Executive Director" },
      ]}
      submitDirective={submitDirective}
      timeZone="America/Chicago"
    />,
  );
  choose("Applies to", "employee:8");
  choose("Directive", "dismissed");
  choose("Reason category", "road_reports");
  fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), {
    target: { value: "The accessible entrance will not be cleared." },
  });
  choose("Recorded by", "1");
  fireEvent.click(screen.getByRole("button", { name: "Issue directive" }));

  expect(await screen.findByRole("status")).toHaveProperty(
    "textContent",
    "Directive issued.",
  );
  expect(submitDirective).toHaveBeenCalledWith({
    scope: { kind: "employee", employeeId: 8 },
    directive: "dismissed",
    reason: {
      category: "road_reports",
      text: "The accessible entrance will not be cleared.",
    },
    issuedById: 1,
  });
  expect(onReload).toHaveBeenCalledTimes(1);
});

it("focuses the status line already on the page once a directive is issued", async () => {
  renderSection();
  const status = screen.getByRole("status");
  choose("Applies to", "facility");
  choose("Directive", "telework");
  choose("Reason category", "road_reports");
  fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), {
    target: { value: "Plows reach the lot after nine." },
  });
  choose("Recorded by", "1");
  fireEvent.click(screen.getByRole("button", { name: "Issue directive" }));

  await waitFor(() => {
    expect(document.activeElement?.textContent).toBe("Directive issued.");
  });
  expect(screen.getByRole("status")).toBe(status);
});

it("focuses the top-most missing field of an empty directive", async () => {
  const submitDirective = renderSection();
  fireEvent.click(screen.getByRole("button", { name: "Issue directive" }));

  const scope = await screen.findByRole("combobox", {
    name: "Applies to",
    description: "Choose who this applies to.",
  });
  expect(document.activeElement).toBe(scope);
  expect(submitDirective).not.toHaveBeenCalled();
});

it("starts the draft over when another decision becomes current", () => {
  const { rerender } = render(<DirectivesSection {...sectionProps()} />);
  choose("Applies to", "building:2");
  fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), {
    target: { value: "Drafted for the accept." },
  });

  rerender(
    <DirectivesSection
      {...sectionProps({ decision: { ...KANSAS_CITY_ACCEPT, id: 2 } })}
    />,
  );

  expect(screen.getByRole("combobox", { name: "Applies to" })).toHaveProperty(
    "value",
    "",
  );
  expect(screen.getByRole("textbox", { name: "Reason" })).toHaveProperty(
    "value",
    "",
  );
});

it("lists a directive's release time, reason category, and recorded issuer", () => {
  render(
    <DirectivesSection {...sectionProps({ directives: [ANNEX_DISMISSAL] })} />,
  );

  expect(
    screen.getByRole("list", { name: "Issued directives" }).textContent,
  ).toBe(
    "Annex: Dismissed, released at Sun, Oct 11, 11:30 CDT" +
      "Local conditions: The Annex has no heat." +
      "Sun, Oct 11, 03:45 CDT, issued by Marcus Oyelaran, State Administrative Officer (unverified)",
  );
});

it("gives a shared name its id so each option names one person or building", () => {
  render(
    <DirectivesSection
      {...sectionProps({
        buildings: [
          {
            id: 2,
            name: "Annex",
            employees: [
              { id: 8, name: "Jordan Lee" },
              { id: 9, name: "Hana Kowalczyk" },
            ],
          },
          { id: 3, name: "Annex", employees: [{ id: 10, name: "Jordan Lee" }] },
        ],
      })}
    />,
  );

  const labels = Array.from(
    screen.getByRole<HTMLSelectElement>("combobox", { name: "Applies to" })
      .options,
    (option) => option.textContent,
  );
  expect(labels).toEqual([
    "Choose…",
    "Whole facility",
    "Essential personnel",
    "Annex (ID 2)",
    "Annex (ID 3)",
    "Jordan Lee (ID 8)",
    "Hana Kowalczyk",
    "Jordan Lee (ID 10)",
  ]);
});

it("says a newer undecided recommendation leaves the standing decision in force", () => {
  render(
    <DirectivesSection {...sectionProps({ isOnShownRecommendation: false })} />,
  );

  expect(
    screen.getByText(
      "Standing decision: Accepted, Delayed arrival, recorded Sun, Oct 11, 03:40 CDT.",
    ),
  ).toBeTruthy();
  expect(
    screen.getByText(
      "The recommendation above is newer and nobody has decided on it, so this decision still stands.",
    ),
  ).toBeTruthy();
});

it("closes the directive form once the decision's notices were dispatched", () => {
  render(<DirectivesSection {...sectionProps({ isDispatched: true })} />);

  expect([
    screen.queryByRole("form", { name: "Issue directive" }),
    screen.getByRole("status").textContent,
  ]).toEqual([
    null,
    "This decision's notices were dispatched, and dispatch happens once, so a new directive would reach nobody. Record a new decision to change what staff are told.",
  ]);
});

it("keeps a dispatch refusal on screen and focused after the reload closes the form", async () => {
  // The reload brings the dispatched decision, as the page does after another tab dispatched.
  let rerender: RenderResult["rerender"] | undefined;
  function reloadDispatched(): Promise<void> {
    rerender?.(<DirectivesSection {...props} isDispatched={true} />);
    return Promise.resolve();
  }
  const props = sectionProps({
    onReload: reloadDispatched,
    submitDirective: () => Promise.resolve({ kind: "dispatched" }),
  });
  ({ rerender } = render(<DirectivesSection {...props} />));
  choose("Applies to", "facility");
  choose("Directive", "telework");
  choose("Reason category", "road_reports");
  fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), {
    target: { value: "Plows reach the lot after nine." },
  });
  choose("Recorded by", "1");
  fireEvent.click(screen.getByRole("button", { name: "Issue directive" }));

  const alert = await screen.findByRole("alert");
  await waitFor(() => {
    expect(document.activeElement).toBe(alert);
  });
  expect([
    alert.textContent,
    screen.queryByRole("form", { name: "Issue directive" }),
  ]).toEqual([
    "This decision's notices were dispatched before your directive arrived, perhaps from another tab. Nothing was saved; the page is reloaded.",
    null,
  ]);
});
