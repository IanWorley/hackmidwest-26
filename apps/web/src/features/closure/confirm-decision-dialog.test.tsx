import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ConfirmDecisionDialog } from "./confirm-decision-dialog";
import type { DecideOutcome, DecisionRequest } from "./decision-api";
import { PREVIEW, TIMEZONE } from "./notification-test-fixtures";
import { useConfirmedDecision } from "./use-confirmed-decision";

const ACCEPT: DecisionRequest = { action: "accept", decidedById: 1 };
const OVERRIDE: DecisionRequest = {
  action: "override",
  chosenPosture: "full_closure",
  decidedById: 1,
  reason: { category: "local_conditions", text: "Water main break on site" },
};
/** Fifteen minutes after HELD_AT, as the form builds it when the dialog opens. */
const DEFER: DecisionRequest = {
  action: "defer",
  recheckAt: "2026-01-15T11:30:00.000Z",
  decidedById: 1,
  reason: { category: "road_reports", text: "Waiting on the county." },
};
/** Any id: these tests never change the recommendation under the dialog. */
const RECOMMENDATION_ID = 1;
const HELD_AT = "2026-01-15T11:15:00.000Z";
const MS_PER_MINUTE = 60_000;
const REVIEW_MINUTES = 5;
const RECORDED: DecideOutcome = { kind: "recorded" };
const OVERRIDE_NOTE =
  "This list is for the recommended posture. Your chosen posture's notice is built after you record the decision, and only if the recommendation times it; Notifications says so when it does not.";

type Record = (request: DecisionRequest) => Promise<DecideOutcome>;

/** Starts a submit the way the decision panel does and renders the dialog it opens. */
function startSubmit(
  record: Record,
  request: DecisionRequest,
): Promise<DecideOutcome> {
  const { result } = renderHook(() =>
    useConfirmedDecision(record, RECOMMENDATION_ID),
  );
  let pending: Promise<DecideOutcome> = Promise.resolve(RECORDED);
  act(() => {
    pending = result.current.submitDecision(request);
  });
  render(
    <ConfirmDecisionDialog
      {...result.current.dialogProps}
      preview={PREVIEW}
      timezone={TIMEZONE}
    />,
  );
  return pending;
}

it("lists who will be notified, then records once and answers the panel on confirm", async () => {
  const record = vi.fn<Record>(() => Promise.resolve(RECORDED));
  const outcome = startSubmit(record, ACCEPT);

  expect(
    screen.getByRole("dialog", { name: "Confirm and notify" }).textContent,
  ).toContain("Grace Hopper");
  expect(record).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Record decision" }));

  expect(await outcome).toEqual(RECORDED);
  expect(record.mock.calls).toEqual([[ACCEPT]]);
});

it("sends nothing and settles as cancelled when the manager goes back", async () => {
  const record = vi.fn<Record>(() => Promise.resolve(RECORDED));
  const outcome = startSubmit(record, ACCEPT);

  fireEvent.click(screen.getByRole("button", { name: "Back" }));

  expect(await outcome).toEqual({ kind: "cancelled" });
  expect(record).not.toHaveBeenCalled();
});

it("says the list is for the recommended posture when the manager overrides", async () => {
  const outcome = startSubmit(vi.fn<Record>(), OVERRIDE);

  expect(screen.getByText(OVERRIDE_NOTE).textContent).toBe(OVERRIDE_NOTE);

  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(await outcome).toEqual({ kind: "cancelled" });
});

it("counts a deferral's recheck interval from confirmation, not from when the dialog opened", async () => {
  vi.useFakeTimers({ now: Date.parse(HELD_AT) });
  try {
    const record = vi.fn<Record>(() => Promise.resolve(RECORDED));
    const outcome = startSubmit(record, DEFER);

    vi.advanceTimersByTime(REVIEW_MINUTES * MS_PER_MINUTE);
    fireEvent.click(screen.getByRole("button", { name: "Record decision" }));

    expect(await outcome).toEqual(RECORDED);
    expect(record.mock.calls).toEqual([
      [{ ...DEFER, recheckAt: "2026-01-15T11:35:00.000Z" }],
    ]);
  } finally {
    vi.useRealTimers();
  }
});

it("tells the manager a deferral notifies nobody instead of listing recipients", async () => {
  const outcome = startSubmit(vi.fn<Record>(), DEFER);

  expect([
    screen.getByRole("status").textContent,
    screen.queryByRole("table", { name: "Who will be notified" }),
  ]).toEqual([
    "A deferral sets no posture, so nobody is notified until a decision does.",
    null,
  ]);

  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(await outcome).toEqual({ kind: "cancelled" });
});
