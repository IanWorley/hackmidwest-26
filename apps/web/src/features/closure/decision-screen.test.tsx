import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DecisionScreen } from "./decision-api";
import { DecisionScreenView } from "./decision-screen";

const HTTP_CREATED = 201;
const HTTP_BAD_GATEWAY = 502;

const SCREEN: DecisionScreen = {
  facility: {
    id: 1,
    name: "Kansas City Area Service Center",
    latitude: 39.0997,
    longitude: -94.5786,
    nwsZone: "MOZ037",
    timezone: "America/Chicago",
    nwpsGaugeId: "KCDM7",
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
    roadClass: "superCommuter",
    hazards: ["winter", "wind", "airQuality"],
  },
  latestRecommendation: null,
  history: [],
  currentDecision: null,
  recorders: [],
  buildings: [],
  directives: [],
  loadedAt: Date.parse("2026-10-11T08:30:00Z"),
};

function evaluationRespondsWith(status: number): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json({}, { status }))),
  );
}

function reloadNothing(): Promise<void> {
  return Promise.resolve();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("moves focus to the recommendation heading once a re-evaluation loads", async () => {
  evaluationRespondsWith(HTTP_CREATED);
  const onReload = vi.fn<() => Promise<void>>(() => Promise.resolve());
  render(<DecisionScreenView onReload={onReload} screen={SCREEN} />);
  fireEvent.click(screen.getByRole("button", { name: "Re-evaluate" }));

  const heading = screen.getByRole("heading", { name: "Recommendation" });
  await waitFor(() => {
    expect(document.activeElement).toBe(heading);
  });
  expect(screen.getByRole("status").textContent).toBe(
    "New recommendation loaded.",
  );
  expect(onReload).toHaveBeenCalledTimes(1);
});

it("returns focus to Re-evaluate and says nothing changed when it fails", async () => {
  evaluationRespondsWith(HTTP_BAD_GATEWAY);
  render(<DecisionScreenView onReload={reloadNothing} screen={SCREEN} />);
  const button = screen.getByRole("button", { name: "Re-evaluate" });
  fireEvent.click(button);

  await waitFor(() => {
    expect(document.activeElement).toBe(button);
  });
  expect(screen.getByRole("alert").textContent).toBe(
    "Re-evaluation failed. The recommendation shown is unchanged; try again.",
  );
});
