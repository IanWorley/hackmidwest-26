import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { expect, it, vi } from "vitest";
import type { DecideOutcome, DecisionRequest, Recorder } from "./decision-api";
import { DecisionPanel } from "./decision-panel";

const NOW = Date.parse("2026-10-12T08:00:00Z");
const DECIDE_BY = "2026-10-12T10:00:00.000Z";
const CURRENT_DECISION_ID = 7;
const RECOMMENDATION_ID = 3;
const NEWER_RECOMMENDATION_ID = 4;
// Fifteen minutes before DECIDE_BY, so even the shortest re-check would land on the deadline.
const LAST_QUARTER_HOUR = Date.parse("2026-10-12T09:45:00Z");
const RECORDERS: Recorder[] = [
  { id: 1, name: "Dana Whitfield", role: "County Executive Director" },
  { id: 2, name: "Marcus Oyelaran", role: "State Administrative Officer" },
];

function renderPanel(
  outcome: DecideOutcome,
  currentDecisionId?: number,
  reload: () => Promise<void> = () => Promise.resolve(),
): {
  submitDecision: ReturnType<
    typeof vi.fn<(r: DecisionRequest) => Promise<DecideOutcome>>
  >;
  onReload: ReturnType<typeof vi.fn<() => Promise<void>>>;
} {
  const submitDecision = vi.fn<(r: DecisionRequest) => Promise<DecideOutcome>>(
    () => Promise.resolve(outcome),
  );
  const onReload = vi.fn<() => Promise<void>>(reload);
  render(
    <DecisionPanel
      {...panelProps({ submitDecision, onReload })}
      supersedesDecisionId={currentDecisionId}
    />,
  );
  return { submitDecision, onReload };
}

function panelProps(
  overrides: Partial<ComponentProps<typeof DecisionPanel>> = {},
): ComponentProps<typeof DecisionPanel> {
  return {
    decideBy: DECIDE_BY,
    hasCurrentDecision: false,
    now: NOW,
    onReload: () => Promise.resolve(),
    recommendationId: RECOMMENDATION_ID,
    recommendedPosture: "delayed_arrival",
    recorders: RECORDERS,
    submitDecision: () => Promise.resolve({ kind: "recorded" }),
    supersedesDecisionId: undefined,
    ...overrides,
  };
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
    expect(document.activeElement).toBe(reason);
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
    chosenPosture: "full_closure",
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

it("flags and focuses the top-most missing field of an empty override", async () => {
  renderPanel({ kind: "recorded" });
  fireEvent.click(screen.getByRole("button", { name: "Override" }));
  fireEvent.click(screen.getByRole("button", { name: "Record override" }));

  const posture = await screen.findByRole("combobox", {
    name: "Posture instead",
    description: "Choose a posture other than the recommended one.",
  });
  expect(document.activeElement).toBe(posture);
  expect(
    screen
      .getByRole("combobox", { name: "Recorded by" })
      .getAttribute("aria-invalid"),
  ).toBe("false");
});

it("announces an accept through the status line already on the page and focuses it", async () => {
  renderPanel({ kind: "recorded" });
  const status = screen.getByRole("status");
  expect(status.textContent).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Accept" }));
  choose("Recorded by", "1");
  fireEvent.click(screen.getByRole("button", { name: "Record acceptance" }));

  await waitFor(() => {
    expect(document.activeElement?.textContent).toBe("Decision recorded.");
  });
  expect(screen.getByRole("status")).toBe(status);
});

it.each([
  [
    "decisionChanged",
    "Someone else decided first.Nothing was saved. The decision history below is reloaded; review it before you decide again.",
  ],
  [
    "previewRecommendation",
    "That recommendation was a preview, not the live one.Nothing was saved. The page is reloaded with the live recommendation, if there is one; review it before you decide.",
  ],
] as const)("reloads and explains a %s refusal", async (conflict, text) => {
  const { onReload } = renderPanel({ kind: "conflict", conflict });
  fireEvent.click(screen.getByRole("button", { name: "Accept" }));
  choose("Recorded by", "1");
  fireEvent.click(screen.getByRole("button", { name: "Record acceptance" }));

  await waitFor(() => {
    expect(document.activeElement?.textContent).toBe(text);
  });
  expect(screen.getByRole("alert").textContent).toBe(text);
  expect(onReload).toHaveBeenCalledTimes(1);
});

it("holds the refusal notice until the reload has finished", async () => {
  const reload = Promise.withResolvers<void>();
  renderPanel(
    { kind: "conflict", conflict: "newerRecommendation" },
    undefined,
    () => reload.promise,
  );
  fireEvent.click(screen.getByRole("button", { name: "Accept" }));
  choose("Recorded by", "1");
  fireEvent.click(screen.getByRole("button", { name: "Record acceptance" }));

  await screen.findByRole("button", { name: "Recording…" });
  expect(screen.queryByRole("alert")).toBeNull();
  reload.resolve();
  expect((await screen.findByRole("alert")).textContent).toBe(
    "A newer recommendation exists.Nothing was saved. The newer recommendation is now shown above; review it before you decide.",
  );
});

it("closes an open draft when a newer recommendation loads", () => {
  const { rerender } = render(<DecisionPanel {...panelProps()} />);
  fireEvent.click(screen.getByRole("button", { name: "Override" }));
  type("Reason", "Written for the old recommendation.");

  rerender(
    <DecisionPanel
      {...panelProps({ recommendationId: NEWER_RECOMMENDATION_ID })}
    />,
  );

  expect(
    screen.queryByRole("heading", { name: "Override the recommendation" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Override" }));
  expect(screen.getByRole("textbox", { name: "Reason" })).toHaveProperty(
    "value",
    "",
  );
});

it("keeps the refusal notice when its reload brings the newer recommendation", async () => {
  const props = panelProps({
    submitDecision: () =>
      Promise.resolve({ kind: "conflict", conflict: "newerRecommendation" }),
    onReload: () => {
      rerender(
        <DecisionPanel {...props} recommendationId={NEWER_RECOMMENDATION_ID} />,
      );
      return Promise.resolve();
    },
  });
  const { rerender } = render(<DecisionPanel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Accept" }));
  choose("Recorded by", "1");
  fireEvent.click(screen.getByRole("button", { name: "Record acceptance" }));

  expect((await screen.findByRole("alert")).textContent).toBe(
    "A newer recommendation exists.Nothing was saved. The newer recommendation is now shown above; review it before you decide.",
  );
});

it("offers no deferral once no re-check time fits before the deadline", () => {
  render(<DecisionPanel {...panelProps({ now: LAST_QUARTER_HOUR })} />);

  expect(screen.getByRole("button", { name: "Defer" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(
    screen.getByText(
      "No re-check time fits before the decision deadline, so this cannot be deferred.",
    ),
  ).toBeTruthy();
});

it("disables Record deferral when the deadline closes in on an open deferral", () => {
  const { rerender } = render(<DecisionPanel {...panelProps()} />);
  fireEvent.click(screen.getByRole("button", { name: "Defer" }));

  rerender(<DecisionPanel {...panelProps({ now: LAST_QUARTER_HOUR })} />);

  expect(
    screen.getByRole("button", { name: "Record deferral" }),
  ).toHaveProperty("disabled", true);
});
