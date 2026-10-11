import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, render, screen } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useRefreshEvery } from "./use-refresh-every";

const INTERVAL_MS = 60_000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});

afterEach(() => {
  vi.useRealTimers();
});

let loads = 0;
const Route = createRootRoute({
  loader: () => {
    loads += 1;
    return loads;
  },
  component: (): JSX.Element => {
    useRefreshEvery(INTERVAL_MS);
    return <p>{`Loaded ${Route.useLoaderData()}`}</p>;
  },
});

it("re-runs the route loader once per interval while the page stays open", async () => {
  const router = createRouter({
    routeTree: Route,
    history: createMemoryHistory(),
  });
  render(<RouterProvider router={router} />);
  await screen.findByText("Loaded 1");

  act(() => {
    vi.advanceTimersByTime(INTERVAL_MS);
  });

  expect(await screen.findByText("Loaded 2")).toBeTruthy();
});
