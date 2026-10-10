import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

/** Start calls this per request; router state must not be shared between SSR requests. */
export function getRouter() {
  return createRouter({ routeTree, scrollRestoration: true });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
