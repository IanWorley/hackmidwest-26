import { useEffect } from "react";

/**
 * How long to wait before reloading again when a reload still reports the same boundary.
 * A browser clock running ahead of the server fires the timer early; this spaces the retries
 * until the server reaches the boundary, so the page never reloads in a tight loop.
 */
export const BOUNDARY_RETRY_MS = 15_000;

/**
 * Runs `onReload` once the clock reaches `at`, an ISO instant after which the loaded
 * data is stale because the server resolves it against request time.
 */
export function useReloadAt(at: string, onReload: () => Promise<void>): void {
  useEffect(() => {
    // A reload that moves the boundary changes `at`, which cleans this effect up; one that
    // leaves it in place means the server has not reached it yet, so the timer re-arms.
    let cleanedUp = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function reload(): Promise<void> {
      try {
        await onReload();
      } finally {
        if (!cleanedUp) {
          timer = setTimeout(
            reload,
            Math.max(Date.parse(at) - Date.now(), BOUNDARY_RETRY_MS),
          );
        }
      }
    }
    timer = setTimeout(reload, Date.parse(at) - Date.now());
    return (): void => {
      cleanedUp = true;
      clearTimeout(timer);
    };
  }, [at, onReload]);
}
