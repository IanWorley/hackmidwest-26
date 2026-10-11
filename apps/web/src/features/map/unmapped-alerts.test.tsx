import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { AlertFeature } from "./load-map";
import { UnmappedAlerts } from "./unmapped-alerts";

const PROPERTIES = {
  headline: null,
  severity: "Severe",
  certainty: "Likely",
  urgency: "Expected",
  onset: "2026-01-14T06:00:00Z",
  ends: "2026-01-15T03:00:00Z",
} as const;

const MAPPED: AlertFeature = {
  type: "Feature",
  id: "urn:oid:mapped",
  geometry: { type: "Polygon", coordinates: [] },
  properties: { ...PROPERTIES, event: "Tornado Warning" },
};

const UNMAPPED: AlertFeature = {
  type: "Feature",
  id: "urn:oid:unmapped",
  geometry: null,
  properties: { ...PROPERTIES, event: "Winter Storm Warning" },
};

it("lists only the alerts that have no mapped area, with their hazard window", () => {
  render(<UnmappedAlerts alerts={[MAPPED, UNMAPPED]} />);

  const list = screen.getByRole("list", {
    name: "Alerts without a mapped area",
  });
  expect(list.textContent).toBe(
    "Winter Storm Warning, Jan 14, 2026, 6:00 AM UTC → Jan 15, 2026, 3:00 AM UTC",
  );
});
