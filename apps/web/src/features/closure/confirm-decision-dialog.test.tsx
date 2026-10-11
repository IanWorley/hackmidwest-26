import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ConfirmDecisionDialog } from "./confirm-decision-dialog";
import { PREVIEW, TIMEZONE } from "./notification-test-fixtures";
import {
  type ConfirmDialogState,
  useConfirmedSubmit,
} from "./use-confirmed-submit";

interface Body {
  readonly action: "accept";
}

const BODY: Body = { action: "accept" };

function requestConfirmation(submit: (body: Body) => Promise<void>): {
  readonly current: () => ConfirmDialogState;
} {
  const { result } = renderHook(() => useConfirmedSubmit(submit));
  act(() => result.current.request(BODY));
  render(
    <ConfirmDecisionDialog
      {...result.current.dialogProps}
      chosenDiffersFromRecommended={false}
      preview={PREVIEW}
      timezone={TIMEZONE}
    />,
  );
  return { current: () => result.current.dialogProps };
}

it("lists who will be notified before submitting, then submits the body once on confirm", async () => {
  const submit = vi.fn<(body: Body) => Promise<void>>(() => Promise.resolve());
  const dialog = requestConfirmation(submit);

  expect(
    screen.getByRole("dialog", { name: "Confirm and notify" }).textContent,
  ).toContain("Grace Hopper");
  expect(submit).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Record decision" }));
  await vi.waitFor(() => expect(dialog.current().open).toBe(false));
  expect(submit.mock.calls).toEqual([[BODY]]);
});

it("submits nothing when the manager goes back", () => {
  const submit = vi.fn<(body: Body) => Promise<void>>(() => Promise.resolve());
  const dialog = requestConfirmation(submit);

  fireEvent.click(screen.getByRole("button", { name: "Back" }));

  expect(dialog.current().open).toBe(false);
  expect(submit).not.toHaveBeenCalled();
});
