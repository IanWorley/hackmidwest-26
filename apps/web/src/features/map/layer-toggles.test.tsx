import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { LayerToggles } from "./layer-toggles";
import { MAP_LAYERS, validateLayersSearch } from "./layers";

it("adds a pressed layer to the URL and removes it when pressed again", async () => {
  const rootRoute = createRootRoute();
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({
        getParentRoute: () => rootRoute,
        path: "conditions",
        validateSearch: validateLayersSearch,
        component: () => <LayerToggles available={MAP_LAYERS} />,
      }),
    ]),
    history: createMemoryHistory({
      initialEntries: ["/conditions?layers=alerts"],
    }),
  });
  render(<RouterProvider router={router} />);

  fireEvent.click(await screen.findByRole("button", { name: "Radar" }));
  await waitFor(() =>
    expect(router.state.location.search).toEqual({ layers: "alerts,radar" }),
  );

  fireEvent.click(screen.getByRole("button", { name: "Radar" }));
  await waitFor(() =>
    expect(router.state.location.search).toEqual({ layers: "alerts" }),
  );
});
