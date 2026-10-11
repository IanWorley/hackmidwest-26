import { expect, it } from "vitest";
import { baselineStatus, type StatusEvent } from "./baseline";

const NOW = "2026-10-12T11:00:00.000Z";
const AFTER_NOW = "2026-10-12T12:00:00.000Z";
const SEED_INSTANT = "2026-10-01T12:00:00.000Z";
const CORRECTION_INSTANT = "2026-10-02T12:00:00.000Z";
const EMPLOYEE_ID = 1;
const MANAGER_ID = 1;

function statusEvent(
  fields: Pick<StatusEvent, "id" | "status"> & Partial<StatusEvent>,
): StatusEvent {
  return {
    employeeId: EMPLOYEE_ID,
    note: null,
    reportedById: MANAGER_ID,
    reportedAt: SEED_INSTANT,
    effectiveFrom: SEED_INSTANT,
    ...fields,
  };
}

it("ignores a status event whose effectiveFrom is after now", () => {
  const current = statusEvent({ id: 1, status: "teleworking" });
  const futureLeave = statusEvent({
    id: 2,
    status: "not_working",
    note: "On annual leave through October 16.",
    effectiveFrom: AFTER_NOW,
  });

  expect(baselineStatus(EMPLOYEE_ID, [current, futureLeave], NOW)).toEqual({
    status: "teleworking",
    event: current,
  });
});

it("takes the later-reported of two events effective at the same instant", () => {
  const correction = statusEvent({
    id: 1,
    status: "teleworking",
    reportedAt: CORRECTION_INSTANT,
  });
  const original = statusEvent({ id: 2, status: "working_onsite" });

  expect(baselineStatus(EMPLOYEE_ID, [correction, original], NOW)).toEqual({
    status: "teleworking",
    event: correction,
  });
});

it("ignores a correction reported after now, so a replay sees only what was known", () => {
  const known = statusEvent({ id: 1, status: "working_onsite" });
  const laterCorrection = statusEvent({
    id: 2,
    status: "teleworking",
    reportedAt: AFTER_NOW,
  });

  expect(baselineStatus(EMPLOYEE_ID, [known, laterCorrection], NOW)).toEqual({
    status: "working_onsite",
    event: known,
  });
});
