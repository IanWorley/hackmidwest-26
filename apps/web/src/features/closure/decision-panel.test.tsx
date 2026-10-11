import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { DecideOutcome, DecisionRequest, Recorder } from "./decision-api";
import { DecisionPanel } from "./decision-panel";

const NOW = Date.parse("2026-10-12T08:00:00Z");
const DECIDE_BY = "2026-10-12T10:00:00.000Z";
const CURRENT_DECISION_ID = 7;
const RECORDERS: Recorder[] = [
  { id: 1, name: "Dana Whitfield", role: "County Executive Director" },
  { id: 2, name: "Marcus Oyelaran", role: "State Administrative Officer" },
];

function renderPanel(
  outcome: DecideOutcome,
  currentDecisionId?: number,
): {
  submitDecision: ReturnType<
    typeof vi.fn<(r: DecisionRequest) => Promise<DecideOutcome>>
  >;
  onReload: ReturnType<typeof vi.fn<() => Promise<void>>>;
} {
  const submitDecision = vi.fn<(r: DecisionRequest) => Promise<DecideOutcome>>(
    () => Promise.resolve(outcome),
  );
  const onReload = vi.fn<() => Promise<void>>(() => Promise.resolve());
  render(
    <DecisionPanel
      currentDecisionId={currentDecisionId}
      decideBy={DECIDE_BY}
      now={NOW}
      onReload={onReload}
      recommendedPosture="delayed_arrival"
      recorders={RECORDERS}
      submitDecision={submitDecision}
    />,
  );
  return { submitDecision, onReload };
}

function choose(label: string, value: string): void {
  fireEvent.change(screen.getByRole("combobox", { name: label }), {
    target: { value },
  });
}

function type(label: string, text: string): void {
  fireEvent.change(screen.getByRole("textbox", { name: label }), {
    target: { value: text },
  });
}

it.each([
  ["Override", "Posture instead", "full_closure", "Record override"],
  ["Defer", "Re-check in", "30", "Record deferral"],
])(
  "%s without a reason flags the reason and records nothing",
  async (action, field, value, submit) => {
    const { submitDecision } = renderPanel({ kind: "recorded" });
    fireEvent.click(screen.getByRole("button", { name: action }));
    choose(field, value);
    choose("Reason category", "road_reports");
    choose("Recorded by", "1");
    fireEvent.click(screen.getByRole("button", { name: submit }));

    const reason = await screen.findByRole("textbox", {
      name: "Reason",
      description: "Enter a reason.",
    });
    expect(reason.getAttribute("aria-invalid")).toBe("true");
    expect(submitDecision).not.toHaveBeenCalled();
  },
);

it("submits an override that supersedes the current decision", async () => {
  const { submitDecision } = renderPanel(
    { kind: "recorded" },
    CURRENT_DECISION_ID,
  );
  fireEvent.click(screen.getByRole("button", { name: "Override" }));
  choose("Posture instead", "full_closure");
  choose("Reason category", "road_reports");
  type("Reason", "  County reports ice on Route 9.  ");
  choose("Recorded by", "2");
  fireEvent.click(screen.getByRole("button", { name: "Record override" }));

  expect(await screen.findByRole("status")).toHaveProperty(
    "textContent",
    "Decision recorded.",
  );
  expect(submitDecision).toHaveBeenCalledWith({
    action: "override",
    posture: "full_closure",
    reason: {
      category: "road_reports",
      text: "County reports ice on Route 9.",
    },
    decidedById: 2,
    supersedesDecisionId: CURRENT_DECISION_ID,
  });
});

it("reloads and explains when a newer recommendation refused the decision", async () => {
  const { onReload } = renderPanel({
    kind: "conflict",
    conflict: "newerRecommendation",
  });
  fireEvent.click(screen.getByRole("button", { name: "Accept" }));
  choose("Recorded by", "1");
  fireEvent.click(screen.getByRole("button", { name: "Record acceptance" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe(
    "A newer recommendation exists.Nothing was saved. The newer recommendation is now shown above; review it before you decide.",
  );
  expect(onReload).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("form")).toBeNull();
});
