import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

/** Re-runs the current route's loaders on an interval, so a page left open keeps up with the API. */
export function useRefreshEvery(intervalMs: number): void {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval((): void => {
      router.invalidate().catch(() => undefined);
    }, intervalMs);
    return (): void => clearInterval(timer);
  }, [router, intervalMs]);
}
