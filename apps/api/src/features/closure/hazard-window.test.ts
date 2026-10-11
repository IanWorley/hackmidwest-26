import { expect, it } from "vitest";
import type { NwsAlert } from "../../clients/nws-model";
import { currentAlerts } from "./hazard-window";

function nwsAlert(
  id: string,
  messageType: NwsAlert["messageType"],
  references: readonly string[] = [],
): NwsAlert {
  return {
    id,
    event: "Winter Storm Warning",
    headline: null,
    severity: "Severe",
    certainty: "Likely",
    urgency: "Expected",
    messageType,
    references: [...references],
    hazardWindow: {
      start: "2026-01-14T06:00:00Z",
      end: "2026-01-14T11:00:00Z",
      endBasis: "ends",
    },
  };
}

const ORIGINAL = nwsAlert("a1", "Alert");
const UPDATE = nwsAlert("u1", "Update", ["a1"]);

it.each([
  { order: "original first", alerts: [ORIGINAL, UPDATE] },
  { order: "update first", alerts: [UPDATE, ORIGINAL] },
])("keeps only the update when it arrives $order", ({ alerts }) => {
  expect(currentAlerts(alerts).map((alert) => alert.id)).toEqual(["u1"]);
});

it("drops a cancelled alert and the cancel itself, keeping unrelated alerts", () => {
  const unrelated = nwsAlert("a2", "Alert");
  const cancel = nwsAlert("c1", "Cancel", ["a1"]);
  expect(
    currentAlerts([ORIGINAL, unrelated, cancel]).map((alert) => alert.id),
  ).toEqual(["a2"]);
});
