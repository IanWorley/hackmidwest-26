import { useEffect, useState } from "react";

const TICK_MS = 15_000;

/**
 * Starts at the loader's instant, so the server render and hydration print the same text,
 * then follows the clock. A reload's later seed wins over an older tick.
 */
export function useNow(seed: number): number {
  const [ticked, setTicked] = useState(seed);
  useEffect(() => {
    const timer = setInterval((): void => setTicked(Date.now()), TICK_MS);
    return (): void => clearInterval(timer);
  }, []);
  return Math.max(seed, ticked);
}
