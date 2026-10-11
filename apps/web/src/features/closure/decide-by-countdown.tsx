import { type JSX, useEffect, useState } from "react";
import { formatCountdown } from "./countdown";
import { formatFacilityTime } from "./format-time";

const TICK_MS = 15_000;
const DECIDE_BY_LABEL = "Decide by";

/** Starts at the loader's instant, so the server render and hydration print the same text, then follows the clock. */
export function useNow(seed: number): number {
  const [now, setNow] = useState(seed);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [seed]);
  return now;
}

export function DecideByCountdown({
  decideBy,
  timeZone,
  now,
}: {
  decideBy: string;
  timeZone: string;
  now: number;
}): JSX.Element {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-muted-foreground text-sm">
        {`${DECIDE_BY_LABEL} ${formatFacilityTime(decideBy, timeZone)}`}
      </p>
      <p aria-live="polite" className="font-semibold text-lg">
        {formatCountdown(Date.parse(decideBy), now)}
      </p>
    </div>
  );
}
