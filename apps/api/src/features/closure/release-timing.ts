import type { Release } from "./effective-status";
import { type Instant, parseInstant } from "./zoned-time";

/** A timed release placed against this person's working day. */
type ReleaseTiming =
  | { readonly kind: "all_day" }
  | { readonly kind: "before_start"; readonly at: Instant }
  | { readonly kind: "during_shift"; readonly at: Instant }
  | {
      readonly kind: "after_shift";
      readonly at: Instant;
      readonly endsAt: Instant;
    };

/** The planner's sendBy anchor and the dismissal wording both follow this split, so they cannot disagree. */
function releaseTiming(
  release: Release,
  workStartsAt: Instant,
  workEndsAt: Instant | null,
): ReleaseTiming {
  if (release === "all_day") {
    return { kind: "all_day" };
  }
  const at = parseInstant(release.at);
  if (at <= workStartsAt) {
    return { kind: "before_start", at };
  }
  if (workEndsAt !== null && at >= workEndsAt) {
    return { kind: "after_shift", at, endsAt: workEndsAt };
  }
  return { kind: "during_shift", at };
}

export { releaseTiming };
