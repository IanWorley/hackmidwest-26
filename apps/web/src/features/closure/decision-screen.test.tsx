import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  ANNEX_DISMISSAL,
  KANSAS_CITY_ACCEPT,
} from "../../../test/decision-fixture";
import { KANSAS_CITY_RECOMMENDATION } from "../../../test/recommendation-fixture";
import type { DecisionScreen } from "./decision-api";
import { DecisionScreenView } from "./decision-screen";

const HTTP_CREATED = 201;
const HTTP_BAD_GATEWAY = 502;
const LOADED_AT = Date.parse("2026-10-11T08:30:00Z");
const MINUTE_MS = 60_000;

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
  facilityDate: "2026-10-11",
  rollsOverAt: "2026-10-11T21:30:00.000Z",
  latestRecommendation: null,
  latestDecisionId: undefined,
  history: [],
  currentDecision: null,
  recorders: [],
  buildings: [],
  directives: [],
  loadedAt: LOADED_AT,
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
  vi.useRealTimers();
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

it("sends an earlier day's recommendation back to Re-evaluate with nothing to decide on", () => {
  render(
    <DecisionScreenView
      onReload={reloadNothing}
      screen={{
        ...SCREEN,
        facilityDate: "2026-10-12",
        latestRecommendation: KANSAS_CITY_RECOMMENDATION,
      }}
    />,
  );

  expect(screen.getByRole("alert").textContent).toBe(
    "This recommendation is for Sun, Oct 11. Re-evaluate for today.",
  );
  expect(screen.queryByRole("heading", { name: "Decide" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Directives" })).toBeNull();
  expect(
    screen.getByRole("heading", { name: "Decision history" }),
  ).toBeTruthy();
});

it("reloads once the facility day rolls over at closing time", () => {
  vi.useFakeTimers({ now: LOADED_AT });
  const onReload = vi.fn<() => Promise<void>>(() => Promise.resolve());
  render(
    <DecisionScreenView
      onReload={onReload}
      screen={{
        ...SCREEN,
        rollsOverAt: new Date(LOADED_AT + MINUTE_MS).toISOString(),
      }}
    />,
  );

  vi.advanceTimersByTime(MINUTE_MS - 1);
  expect(onReload).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(onReload).toHaveBeenCalledTimes(1);
});

it("keeps the standing decision and its directives after a same-day re-evaluation", () => {
  render(
    <DecisionScreenView
      onReload={reloadNothing}
      screen={{
        ...SCREEN,
        latestRecommendation: { ...KANSAS_CITY_RECOMMENDATION, id: 2 },
        history: [KANSAS_CITY_ACCEPT],
        currentDecision: KANSAS_CITY_ACCEPT,
        directives: [ANNEX_DISMISSAL],
      }}
    />,
  );

  expect(screen.getByRole("heading", { name: "Directives" })).toBeTruthy();
  expect(
    screen.getByText(
      "The recommendation above is newer and nobody has decided on it, so this decision still stands.",
    ),
  ).toBeTruthy();
  expect(
    screen.getByRole("list", { name: "Issued directives" }).children,
  ).toHaveLength(1);
});
