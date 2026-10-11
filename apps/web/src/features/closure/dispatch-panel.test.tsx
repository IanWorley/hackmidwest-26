import { fireEvent, render, screen } from "@testing-library/react";
import type { JSX } from "react";
import { expect, it, vi } from "vitest";
import { DispatchPanel } from "./dispatch-panel";
import type {
  DecisionNotificationsResult,
  DispatchResult,
} from "./notification-api";
import { TIMEZONE, UNDISPATCHED } from "./notification-test-fixtures";

const DECISION_ID = 21;

const reloadNothing = vi.fn<() => Promise<void>>(() => Promise.resolve());

/** The server rebuilds the same package it showed, so dispatch goes ahead. */
function refreshUnchanged(_id: number): Promise<DecisionNotificationsResult> {
  return Promise.resolve({ kind: "found", view: UNDISPATCHED });
}

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
      onReload={reloadNothing}
      refresh={refreshUnchanged}
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

it("shows why a decision cannot be dispatched and reloads the screen", async () => {
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
  const onReload = vi.fn(reloadNothing);
  render(
    <DispatchPanel
      decisionId={DECISION_ID}
      dispatch={dispatch}
      initial={UNDISPATCHED}
      onReload={onReload}
      refresh={refreshUnchanged}
      timezone={TIMEZONE}
    />,
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Dispatch notifications" }),
  );

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("This decision was already dispatched");
  await vi.waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
});

it("offers no dispatch when the package has nobody to tell", () => {
  render(
    <DispatchPanel
      decisionId={DECISION_ID}
      dispatch={vi.fn<(id: number) => Promise<DispatchResult>>()}
      initial={{
        ...UNDISPATCHED,
        package: { ...UNDISPATCHED.package, recipients: [] },
      }}
      onReload={reloadNothing}
      refresh={refreshUnchanged}
      timezone={TIMEZONE}
    />,
  );

  expect([
    screen.getByText("Nobody needs a notice.").textContent,
    screen.queryByRole("button", { name: "Dispatch notifications" }),
  ]).toEqual(["Nobody needs a notice.", null]);
});

it("starts fresh when the page reloads with a newer decision", async () => {
  const dispatch = vi.fn(async (_id: number) => DISPATCHED);
  function panel(decisionId: number): JSX.Element {
    return (
      <DispatchPanel
        decisionId={decisionId}
        dispatch={dispatch}
        initial={UNDISPATCHED}
        onReload={reloadNothing}
        refresh={refreshUnchanged}
        timezone={TIMEZONE}
      />
    );
  }
  const { rerender } = render(panel(DECISION_ID));
  fireEvent.click(
    screen.getByRole("button", { name: "Dispatch notifications" }),
  );
  await screen.findByRole("table", { name: "Dispatched notices" });

  rerender(panel(DECISION_ID + 1));

  expect([
    screen.queryByRole("table", { name: "Dispatched notices" }),
    screen.getByRole("button", { name: "Dispatch notifications" }).textContent,
  ]).toEqual([null, "Dispatch notifications"]);
});

it("reloads the screen after a dispatch, so the record chain check covers the new rows", async () => {
  const onReload = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const dispatch = vi.fn(async (_id: number) => DISPATCHED);
  render(
    <DispatchPanel
      decisionId={DECISION_ID}
      dispatch={dispatch}
      initial={UNDISPATCHED}
      onReload={onReload}
      refresh={refreshUnchanged}
      timezone={TIMEZONE}
    />,
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Dispatch notifications" }),
  );
  await screen.findByRole("table", { name: "Dispatched notices" });

  expect(onReload).toHaveBeenCalledTimes(1);
});

it("reloads to show what was recorded when a dispatch gets no clear answer", async () => {
  const dispatch = vi.fn(
    (_id: number): Promise<DispatchResult> =>
      Promise.reject(new TypeError("Failed to fetch")),
  );
  const onReload = vi.fn(reloadNothing);
  render(
    <DispatchPanel
      decisionId={DECISION_ID}
      dispatch={dispatch}
      initial={UNDISPATCHED}
      onReload={onReload}
      refresh={refreshUnchanged}
      timezone={TIMEZONE}
    />,
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Dispatch notifications" }),
  );

  await vi.waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      "The dispatch got no clear answer. The screen is reloaded with what was recorded; if no dispatched notices are listed, try again.",
    ),
  );
  expect(onReload).toHaveBeenCalledTimes(1);
});

it("shows the rebuilt package and sends nothing when it changed since it was shown", async () => {
  const [first, late] = UNDISPATCHED.package.recipients;
  if (first === undefined || late === undefined) {
    throw new Error("The fixture lists two recipients");
  }
  // Rebuilt later, the late notice moves from the preferred channel to the fastest one.
  const rebuilt = {
    ...UNDISPATCHED,
    package: {
      ...UNDISPATCHED.package,
      recipients: [
        first,
        { ...late, channel: "sms", rule: "fastest" } as const,
      ],
    },
  };
  const dispatch = vi.fn(async (_id: number) => DISPATCHED);
  const refresh = vi.fn(
    (_id: number): Promise<DecisionNotificationsResult> =>
      Promise.resolve({ kind: "found", view: rebuilt }),
  );
  render(
    <DispatchPanel
      decisionId={DECISION_ID}
      dispatch={dispatch}
      initial={UNDISPATCHED}
      onReload={reloadNothing}
      refresh={refresh}
      timezone={TIMEZONE}
    />,
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Dispatch notifications" }),
  );

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Who is told, or how, changed since this list was shown. Nothing was sent; review the list below and dispatch again.",
  );
  expect([
    dispatch.mock.calls,
    screen.getByRole("table", { name: "Who will be notified" }).textContent,
  ]).toEqual([[], expect.stringContaining("Grace HopperText message")]);
});
