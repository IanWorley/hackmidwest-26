import type { Release } from "./effective-status";
import { type Instant, parseInstant } from "./zoned-time";

/** A person's working day: their shift, else the facility's arrival window start and closing time. */
interface WorkDay {
  readonly startsAt: Instant;
  readonly endsAt: Instant;
}

/** Where `now` falls in their working day. Every instruction is worded for that moment. */
type DayPhase = "before_start" | "during_shift" | "after_shift";

/** A timed release placed against this person's working day. */
type ReleaseTiming =
  | { readonly kind: "all_day" }
  | { readonly kind: "before_start"; readonly at: Instant }
  | { readonly kind: "during_shift"; readonly at: Instant }
  | { readonly kind: "after_shift"; readonly at: Instant };

function dayPhase(now: Instant, { startsAt, endsAt }: WorkDay): DayPhase {
  if (now < startsAt) {
    return "before_start";
  }
  if (now < endsAt) {
    return "during_shift";
  }
  return "after_shift";
}

/** The planner's sendBy anchor and the dismissal wording both follow this split, so they cannot disagree. */
function releaseTiming(
  release: Release,
  { startsAt, endsAt }: WorkDay,
): ReleaseTiming {
  if (release === "all_day") {
    return { kind: "all_day" };
  }
  const at = parseInstant(release.at);
  if (at <= startsAt) {
    return { kind: "before_start", at };
  }
  if (at >= endsAt) {
    return { kind: "after_shift", at };
  }
  return { kind: "during_shift", at };
}

export type { DayPhase, WorkDay };
export { dayPhase, releaseTiming };
