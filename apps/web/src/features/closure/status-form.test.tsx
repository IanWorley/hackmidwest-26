import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  MAIN_OFFICE,
  ONSITE,
  personnel,
  resolvedPerson,
} from "./personnel-test-fixtures";
import type { RecordStatus } from "./record-status";
import { UpdateStatusDialog } from "./status-form";

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
