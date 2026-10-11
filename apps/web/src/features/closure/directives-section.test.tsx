import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
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
