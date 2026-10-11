import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DecideByCountdown } from "./decide-by-countdown";
import { useNow } from "./use-now";

const LOADED_AT = Date.parse("2026-10-11T08:30:00Z");
const DECIDE_BY = "2026-10-11T10:00:00.000Z";
const TIME_ZONE = "America/Chicago";
const ONE_MINUTE_MS = 60_000;

afterEach(() => {
  vi.useRealTimers();
});

it("shows the deadline and counts down as the clock ticks", () => {
  vi.useFakeTimers({ now: LOADED_AT });
  const clock = renderHook(() => useNow(LOADED_AT));
  const view = render(
    <DecideByCountdown
      decideBy={DECIDE_BY}
      now={clock.result.current}
      timeZone={TIME_ZONE}
    />,
  );

  expect(screen.getByText("Decide by Sun, Oct 11, 05:00 CDT")).toBeTruthy();
  expect(screen.getByText("1 h 30 min left to decide")).toBeTruthy();

  act(() => {
    vi.advanceTimersByTime(ONE_MINUTE_MS);
  });
  view.rerender(
    <DecideByCountdown
      decideBy={DECIDE_BY}
      now={clock.result.current}
      timeZone={TIME_ZONE}
    />,
  );

  expect(screen.getByText("1 h 29 min left to decide")).toBeTruthy();
});
