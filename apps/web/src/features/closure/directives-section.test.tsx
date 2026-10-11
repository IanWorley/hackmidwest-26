import { fireEvent, render, screen } from "@testing-library/react";
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
