import { useEffect } from "react";

/**
 * Runs `onReload` once the clock reaches `at`, an ISO instant after which the loaded
 * data is stale because the server resolves it against request time.
 */
export function useReloadAt(at: string, onReload: () => Promise<void>): void {
  useEffect(() => {
    const timer = setTimeout(onReload, Date.parse(at) - Date.now());
    return (): void => clearTimeout(timer);
  }, [at, onReload]);
}
