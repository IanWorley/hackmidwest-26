import type { JSX } from "react";
import { formatCountdown } from "./countdown";
import { formatFacilityTime } from "./format-time";

const DECIDE_BY_LABEL = "Decide by";

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
