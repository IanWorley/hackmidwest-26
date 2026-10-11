import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DecideByCountdown } from "./posture-fields";

const NOW = "2026-10-11T12:00:00.000Z";

beforeEach(() => {
  vi.useFakeTimers({ now: Date.parse(NOW) });
});

afterEach(() => {
  vi.useRealTimers();
});

it("reports a deadline that has passed as overdue", () => {
  render(<DecideByCountdown decideBy="2026-10-11T11:59:00.000Z" />);
  expect(screen.getByText("Decision overdue")).toBeTruthy();
});

it("counts down to a future deadline in hours and minutes", () => {
  render(<DecideByCountdown decideBy="2026-10-11T13:30:00.000Z" />);
  expect(screen.getByText("Decide in 1 h 30 min")).toBeTruthy();
});
