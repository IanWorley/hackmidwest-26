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
const RECOVERED_TEXT = "Recovered";
const ERROR_TEXT = "Could not load";

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

let flakyLoads = 0;
const FlakyRoute = createRootRoute({
  loader: () => {
    flakyLoads += 1;
    if (flakyLoads === 1) {
      throw new Error("API unreachable");
    }
    return flakyLoads;
  },
  component: (): JSX.Element => <p>{RECOVERED_TEXT}</p>,
  errorComponent: (): JSX.Element => {
    useRefreshEvery(INTERVAL_MS);
    return <p>{ERROR_TEXT}</p>;
  },
});

it("keeps refreshing from the error view, so the page recovers when the API does", async () => {
  const router = createRouter({
    routeTree: FlakyRoute,
    history: createMemoryHistory(),
  });
  render(<RouterProvider router={router} />);
  await screen.findByText(ERROR_TEXT);

  act(() => {
    vi.advanceTimersByTime(INTERVAL_MS);
  });

  expect(await screen.findByText(RECOVERED_TEXT)).toBeTruthy();
});
