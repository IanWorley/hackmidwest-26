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

it("lets the manager retry after the request fails to reach the API", async () => {
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
      "The status could not be saved. Try again.",
    );
  });
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Save status" })
      .disabled,
  ).toBe(false);
});

it("starts a not-working person's note from their current reason", () => {
  const onLeave: ResolvedPerson = {
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
  openDialog(onLeave, vi.fn<RecordStatus>());

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
