import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { FacilitiesList } from "./facilities-list";
import type { Facility } from "./load-facilities";

const KANSAS_CITY: Facility = {
  id: 1,
  name: "Kansas City Area Service Center",
  latitude: 39.0997,
  longitude: -94.5786,
  nwsZone: "MOZ037",
  timezone: "America/Chicago",
  opensAt: "07:30",
  closesAt: "16:30",
  arrivalWindowStart: "06:30",
  arrivalWindowEnd: "09:00",
  departureWindowStart: "15:30",
  departureWindowEnd: "18:00",
  typicalCommuteMinutes: 35,
  decisionDeadline: "05:00",
  notificationLeadMinutes: 60,
  decisionMakerId: 1,
  backupDecisionMakerId: 2,
  hazards: ["winter", "wind", "airQuality"],
};

it("links each facility to its detail page and labels its hazards", async () => {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <FacilitiesList facilities={[KANSAS_CITY]} />,
    }),
    history: createMemoryHistory(),
  });
  render(<RouterProvider router={router} />);

  const link = await screen.findByRole("link", {
    name: "Kansas City Area Service Center",
  });
  expect(link.getAttribute("href")).toBe("/facilities/1");
  expect(
    screen.getAllByRole("listitem").map((hazard) => hazard.textContent),
  ).toEqual(["Winter storm", "High wind", "Air quality"]);
});
