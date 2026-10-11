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
    currentDecision: null,
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
    currentDecision: {
      recommendationId: 8,
      action: "override",
      chosenPosture: "normal",
      decidedAt: "2026-10-11T08:30:00.000Z",
      recheckAt: null,
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
    currentDecision: {
      recommendationId: 9,
      action: "defer",
      chosenPosture: null,
      decidedAt: "2026-10-11T08:30:00.000Z",
      recheckAt: "2026-10-11T09:15:00.000Z",
    },
  },
};

const MISSED: MapFacility = {
  id: 5,
  name: "Missed Deadline Service Center",
  lat: 38.6,
  lon: -90.2,
  aqi: null,
  standing: {
    posture: "full_closure",
    recommendationId: 10,
    decideBy: "2026-01-01T11:00:00.000Z",
    asOf: "2026-01-01T09:00:00.000Z",
    currentDecision: {
      recommendationId: 10,
      action: "no_decision",
      chosenPosture: null,
      decidedAt: "2026-01-01T11:01:00.000Z",
      recheckAt: null,
    },
  },
};

/** Accepted this morning, then re-evaluated the same facility day with nobody deciding on the new recommendation yet. */
const ACCEPTED_THEN_REEVALUATED: MapFacility = {
  id: 6,
  name: "Omaha Service Center",
  lat: 41.2565,
  lon: -95.9345,
  aqi: null,
  standing: {
    posture: "full_closure",
    recommendationId: 12,
    decideBy: "2026-10-11T12:00:00.000Z",
    asOf: "2026-10-11T10:00:00.000Z",
    currentDecision: {
      recommendationId: 11,
      action: "accept",
      chosenPosture: "delayed_arrival",
      decidedAt: "2026-10-11T08:30:00.000Z",
      recheckAt: null,
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

/** The posture cell's parts, each its own line, as a reader sees them. */
function postureParts(cell: HTMLElement | undefined): (string | null)[] {
  return [...(cell?.firstElementChild?.children ?? [])].map(
    (part) => part.textContent,
  );
}

async function renderDashboard(
  facilities: readonly MapFacility[] = [
    UNDECIDED,
    OVERRIDDEN,
    DEFERRED,
    NOT_EVALUATED,
  ],
): Promise<void> {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => <StandingDashboard facilities={facilities} />,
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
        postureParts(within(row).getAllByRole("cell")[1]),
        within(row).getAllByRole("cell")[3]?.textContent,
      ];
    }),
  ).toEqual([
    [
      "Kansas City Area Service Center",
      "/facilities/1",
      ["Full closure", "As of Oct 11, 2026, 8:00 AM UTC"],
      "Decision needed",
    ],
    [
      "Fargo Service Center",
      "/facilities/2",
      [
        "Normal operations",
        "Recommended: Full closure",
        "As of Oct 11, 2026, 8:00 AM UTC",
      ],
      "Overridden",
    ],
    [
      "Lafayette Service Center",
      "/facilities/4",
      ["Delayed arrival", "As of Oct 11, 2026, 8:00 AM UTC"],
      "Deferred",
    ],
    ["Yakima Service Center", "/facilities/3", ["Not evaluated"], "—"],
  ]);
});

it("keeps a missed decision in the count and shows its deadline as overdue", async () => {
  await renderDashboard([MISSED]);
  const cells = screen.getAllByRole("cell");
  expect([
    screen.getByRole("status").textContent,
    cells[2]?.textContent,
    cells[3]?.textContent,
  ]).toEqual(["Decisions needed: 1", "Decision overdue", "Missed decision"]);
});

it("keeps an earlier same-day decision in effect while a re-evaluation awaits its own decision", async () => {
  await renderDashboard([ACCEPTED_THEN_REEVALUATED]);
  const cells = screen.getAllByRole("cell");
  expect([
    screen.getByRole("status").textContent,
    postureParts(cells[1]),
    cells[2]?.querySelector("time")?.getAttribute("dateTime"),
    cells[3]?.textContent,
  ]).toEqual([
    "Decisions needed: 1",
    [
      "Delayed arrival",
      "Recommended: Full closure",
      "As of Oct 11, 2026, 10:00 AM UTC",
    ],
    "2026-10-11T12:00:00.000Z",
    "Decision needed",
  ]);
});
