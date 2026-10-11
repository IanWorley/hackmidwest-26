import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DispatchPanel } from "./dispatch-panel";
import type { DispatchResult } from "./notification-api";
import { TIMEZONE, UNDISPATCHED } from "./notification-test-fixtures";

const DECISION_ID = 21;

const DISPATCHED: DispatchResult = {
  kind: "dispatched",
  view: {
    ...UNDISPATCHED,
    dispatches: [
      {
        employeeId: 11,
        channel: "sms",
        plannedAt: "2026-01-15T11:30:00.000Z",
        recordedAt: "2026-01-15T11:20:00.000Z",
        minutesBeforeArrivalWindow: 70,
        recordedAfterSendBy: false,
      },
      {
        employeeId: 12,
        channel: "email",
        plannedAt: "2026-01-15T04:45:00.000Z",
        recordedAt: "2026-01-15T12:45:00.000Z",
        minutesBeforeArrivalWindow: -15,
        recordedAfterSendBy: true,
      },
    ],
  },
};

it("dispatches the decision and shows each notice's lead time", async () => {
  const dispatch = vi.fn(async (_id: number) => DISPATCHED);
  render(
    <DispatchPanel
      decisionId={DECISION_ID}
      dispatch={dispatch}
      initial={UNDISPATCHED}
      timezone={TIMEZONE}
    />,
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Dispatch notifications" }),
  );
  const table = await screen.findByRole("table", {
    name: "Dispatched notices",
  });

  expect(dispatch.mock.calls).toEqual([[DECISION_ID]]);
  expect(
    Array.from(table.querySelectorAll("tbody tr"), (row) =>
      Array.from(row.querySelectorAll("td"), (cell) => cell.textContent),
    ),
  ).toEqual([
    [
      "Ada Lovelace",
      "Text message",
      "05:20",
      "Notified 70 min before the arrival window",
    ],
    [
      "Grace Hopper",
      "Email",
      "06:45",
      "Recorded 15 min after the arrival window openedAfter send-by",
    ],
  ]);
});

it("shows why a decision cannot be dispatched", async () => {
  const dispatch = vi.fn(
    async (_id: number): Promise<DispatchResult> => ({
      kind: "conflict",
      conflict: {
        conflict: "already_dispatched",
        message: "This decision was already dispatched",
        recordedAt: "2026-01-15T11:20:00.000Z",
      },
    }),
  );
  render(
    <DispatchPanel
      decisionId={DECISION_ID}
      dispatch={dispatch}
      initial={UNDISPATCHED}
      timezone={TIMEZONE}
    />,
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Dispatch notifications" }),
  );

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("This decision was already dispatched");
});
