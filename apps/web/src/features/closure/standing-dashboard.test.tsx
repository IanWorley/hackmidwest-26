import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import type { MapFacility } from "@/features/map/load-map";
import { StandingDashboard } from "./standing-dashboard";

const UNDECIDED: MapFacility = {
  id: 1,
  name: "Kansas City Area Service Center",
  lat: 39.0997,
  lon: -94.5786,
  aqi: null,
  standing: {
    posture: "full_closure",
    recommendationId: 7,
    decideBy: "2026-10-11T10:00:00.000Z",
    asOf: "2026-10-11T08:00:00.000Z",
    decision: null,
  },
};

const OVERRIDDEN: MapFacility = {
  id: 2,
  name: "Fargo Service Center",
  lat: 46.8772,
  lon: -96.7898,
  aqi: null,
  standing: {
    posture: "full_closure",
    recommendationId: 8,
    decideBy: "2026-10-11T10:00:00.000Z",
    asOf: "2026-10-11T08:00:00.000Z",
    decision: {
      action: "override",
      chosenPosture: "normal",
      decidedAt: "2026-10-11T08:30:00.000Z",
    },
  },
};

const DEFERRED: MapFacility = {
  id: 4,
  name: "Lafayette Service Center",
  lat: 30.2241,
  lon: -92.0198,
  aqi: null,
  standing: {
    posture: "delayed_arrival",
    recommendationId: 9,
    decideBy: "2026-10-11T10:00:00.000Z",
    asOf: "2026-10-11T08:00:00.000Z",
    decision: {
      action: "defer",
      chosenPosture: null,
      decidedAt: "2026-10-11T08:30:00.000Z",
    },
  },
};

const NOT_EVALUATED: MapFacility = {
  id: 3,
  name: "Yakima Service Center",
  lat: 46.6021,
  lon: -120.5059,
  aqi: null,
  standing: { posture: "not_evaluated" },
};

async function renderDashboard(): Promise<void> {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <StandingDashboard
          facilities={[UNDECIDED, OVERRIDDEN, DEFERRED, NOT_EVALUATED]}
        />
      ),
    }),
    history: createMemoryHistory(),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole("table", { name: "Facility standing" });
}

it("counts undecided and deferred facilities as needing a decision, not overridden or unevaluated ones", async () => {
  await renderDashboard();
  expect(screen.getByRole("status").textContent).toBe("Decisions needed: 2");
});

it("shows each row's posture in effect, its decision status, and a link to the facility page", async () => {
  await renderDashboard();
  const rows = screen.getAllByRole("row").slice(1);
  expect(
    rows.map((row) => {
      const link = within(row).getByRole("link");
      return [
        link.textContent,
        link.getAttribute("href"),
        within(row).getAllByRole("cell")[1]?.textContent,
        within(row).getAllByRole("cell")[3]?.textContent,
      ];
    }),
  ).toEqual([
    [
      "Kansas City Area Service Center",
      "/facilities/1",
      "Full closureAs of Oct 11, 2026, 8:00 AM UTC",
      "Decision needed",
    ],
    [
      "Fargo Service Center",
      "/facilities/2",
      "Normal operationsRecommended: Full closureAs of Oct 11, 2026, 8:00 AM UTC",
      "Overridden",
    ],
    [
      "Lafayette Service Center",
      "/facilities/4",
      "Delayed arrivalAs of Oct 11, 2026, 8:00 AM UTC",
      "Deferred",
    ],
    ["Yakima Service Center", "/facilities/3", "Not evaluated", "—"],
  ]);
});
