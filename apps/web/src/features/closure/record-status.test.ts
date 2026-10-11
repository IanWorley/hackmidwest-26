import { afterEach, expect, it, vi } from "vitest";
import { recordEmployeeStatus } from "./record-status";

const EMPLOYEE_ID = 7;
const RECORDER_ID = 1;

afterEach(() => {
  vi.unstubAllGlobals();
});

it("throws when the connection drops, so the save is reconciled rather than retried", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
  );

  await expect(
    recordEmployeeStatus(EMPLOYEE_ID, {
      status: "teleworking",
      reportedById: RECORDER_ID,
    }),
  ).rejects.toThrow("The status save got no response");
});
