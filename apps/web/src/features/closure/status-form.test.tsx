import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  MAIN_OFFICE,
  ONSITE,
  personnel,
  resolvedPerson,
} from "./personnel-test-fixtures";
import type { RecordStatus } from "./record-status";
import type { ResolvedPerson } from "./roster-filter";
import { UpdateStatusDialog } from "./status-form";

const GIDEON_ID = 7;
const LEAVE_NOTE = "On annual leave through October 16.";
const SEED_INSTANT = "2026-10-01T12:00:00.000Z";

const AVERY = resolvedPerson(1, "Avery Calloway", {
  building: MAIN_OFFICE,
  essential: false,
  effective: ONSITE,
});

it("will not record a status until someone is chosen as Recorded by", () => {
  const recordStatus = vi.fn<RecordStatus>();
  render(
    <UpdateStatusDialog
      person={AVERY}
      recorders={personnel([AVERY]).recorders}
      recordStatus={recordStatus}
    />,
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Update status for Avery Calloway" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save status" }));

  expect(screen.getByRole("alert").textContent).toBe(
    "Choose who is recording this status.",
  );
  expect(recordStatus).not.toHaveBeenCalled();
});

function openDialog(person: ResolvedPerson, recordStatus: RecordStatus): void {
  render(
    <UpdateStatusDialog
      person={person}
      recorders={personnel([person]).recorders}
      recordStatus={recordStatus}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: `Update status for ${person.name}` }),
  );
}

it("asks the manager to check, not retry, when a save cannot be confirmed", async () => {
  openDialog(
    AVERY,
    vi.fn<RecordStatus>().mockRejectedValue(new TypeError("Failed to fetch")),
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Recorded by" }), {
    target: { value: "1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save status" }));

  await waitFor(() => {
    expect(screen.getByRole("alert").textContent).toBe(
      "The save could not be confirmed. The table has been refreshed; check this person's status before saving again.",
    );
  });
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Save status" })
      .disabled,
  ).toBe(false);
});

function gideonOnLeave(): ResolvedPerson {
  return {
    ...resolvedPerson(GIDEON_ID, "Gideon Marsh", {
      building: MAIN_OFFICE,
      essential: false,
      effective: ONSITE,
    }),
    baseline: {
      status: "not_working",
      note: LEAVE_NOTE,
      event: {
        id: GIDEON_ID,
        employeeId: GIDEON_ID,
        status: "not_working",
        note: LEAVE_NOTE,
        reportedById: 1,
        reportedAt: SEED_INSTANT,
        effectiveFrom: SEED_INSTANT,
      },
    },
  };
}

it("starts a not-working person's note from their current reason", () => {
  openDialog(gideonOnLeave(), vi.fn<RecordStatus>());

  expect(
    screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Note" }).value,
  ).toBe(LEAVE_NOTE);
});

it("stays open while a save is in flight", async () => {
  openDialog(
    AVERY,
    vi.fn<RecordStatus>(() => new Promise<never>(() => undefined)),
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Recorded by" }), {
    target: { value: "1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save status" }));
  await waitFor(() => {
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Cancel" })
        .disabled,
    ).toBe(true);
  });

  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

  expect(
    screen.getByRole("dialog", { name: "Update status for Avery Calloway" }),
  ).toBeTruthy();
});

it("drops a not-working reason when the person is recorded as working again", async () => {
  const recordStatus = vi.fn<RecordStatus>(() =>
    Promise.resolve({ kind: "recorded" }),
  );
  openDialog(gideonOnLeave(), recordStatus);
  fireEvent.change(screen.getByRole("combobox", { name: "Status" }), {
    target: { value: "working_onsite" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Recorded by" }), {
    target: { value: "1" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save status" }));

  await waitFor(() => {
    expect(recordStatus).toHaveBeenCalledWith(GIDEON_ID, {
      status: "working_onsite",
      reportedById: 1,
    });
  });
});

it("starts over from the person's new status when it changes under an open form", () => {
  const recordStatus = vi.fn<RecordStatus>();
  const { rerender } = render(
    <UpdateStatusDialog
      person={AVERY}
      recorders={personnel([AVERY]).recorders}
      recordStatus={recordStatus}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Update status for Avery Calloway" }),
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Status" }), {
    target: { value: "teleworking" },
  });

  const reloaded = gideonOnLeave();
  rerender(
    <UpdateStatusDialog
      person={{ ...AVERY, baseline: reloaded.baseline }}
      recorders={personnel([AVERY]).recorders}
      recordStatus={recordStatus}
    />,
  );

  expect(
    screen.getByRole<HTMLSelectElement>("combobox", { name: "Status" }).value,
  ).toBe("not_working");
  expect(screen.getByRole("status").textContent).toBe(
    "Avery Calloway's status changed while this form was open. The form now shows the current status.",
  );
});
