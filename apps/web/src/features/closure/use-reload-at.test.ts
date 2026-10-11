import { renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BOUNDARY_RETRY_MS, useReloadAt } from "./use-reload-at";

const BOUNDARY = "2026-01-14T23:00:00.000Z";

afterEach(() => {
  vi.useRealTimers();
});

it("reloads again, no sooner than the retry delay, when a reload leaves the boundary pending", async () => {
  vi.useFakeTimers({ now: Date.parse(BOUNDARY) });
  const onReload = vi.fn(() => Promise.resolve());
  renderHook(() => useReloadAt(BOUNDARY, onReload));

  await vi.advanceTimersByTimeAsync(0);
  expect(onReload).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(BOUNDARY_RETRY_MS - 1);
  expect(onReload).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(1);
  expect(onReload).toHaveBeenCalledTimes(2);
});
