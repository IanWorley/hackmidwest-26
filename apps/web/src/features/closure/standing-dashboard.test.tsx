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
    decided: false,
  },
};

const DECIDED: MapFacility = {
  id: 2,
  name: "Fargo Service Center",
  lat: 46.8772,
  lon: -96.7898,
  aqi: null,
  standing: {
    posture: "normal",
    recommendationId: 8,
    decideBy: "2026-10-11T10:00:00.000Z",
    asOf: "2026-10-11T08:00:00.000Z",
    decided: true,
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
        <StandingDashboard facilities={[UNDECIDED, DECIDED, NOT_EVALUATED]} />
      ),
    }),
    history: createMemoryHistory(),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole("table", { name: "Facility standing" });
}

it("counts only evaluated facilities without a recorded decision", async () => {
  await renderDashboard();
  expect(screen.getByRole("status").textContent).toBe("Decisions needed: 1");
});

it("labels each row's posture and evaluation time and links its name to the facility page", async () => {
  await renderDashboard();
  const rows = screen.getAllByRole("row").slice(1);
  expect(
    rows.map((row) => {
      const link = within(row).getByRole("link");
      return [
        link.textContent,
        link.getAttribute("href"),
        within(row).getAllByRole("cell")[1]?.textContent,
      ];
    }),
  ).toEqual([
    [
      "Kansas City Area Service Center",
      "/facilities/1",
      "Full closureAs of Oct 11, 2026, 8:00 AM UTC",
    ],
    [
      "Fargo Service Center",
      "/facilities/2",
      "Normal operationsAs of Oct 11, 2026, 8:00 AM UTC",
    ],
    ["Yakima Service Center", "/facilities/3", "Not evaluated"],
  ]);
});
