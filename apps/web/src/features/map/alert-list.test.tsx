import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { AlertList } from "./alert-list";
import type { AlertFeature } from "./load-map";

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

it("lists every alert with its hazard window and marks one without a mapped area", () => {
  render(<AlertList alerts={[MAPPED, UNMAPPED]} />);

  const list = screen.getByRole("list", { name: "Active alerts" });
  expect(
    [...list.querySelectorAll("li")].map((item) => item.textContent),
  ).toEqual([
    "Tornado Warning, Jan 14, 2026, 6:00 AM UTC → Jan 15, 2026, 3:00 AM UTC",
    "Winter Storm Warning, Jan 14, 2026, 6:00 AM UTC → Jan 15, 2026, 3:00 AM UTC (no mapped area)",
  ]);
});
