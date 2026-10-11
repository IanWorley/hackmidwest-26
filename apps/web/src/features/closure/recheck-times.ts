const MS_PER_MINUTE = 60_000;
const QUARTER_HOUR_MINUTES = 15;
const HALF_HOUR_MINUTES = 30;
const HOUR_MINUTES = 60;
const TWO_HOURS_MINUTES = 120;
const RECHECK_MINUTES = [
  QUARTER_HOUR_MINUTES,
  HALF_HOUR_MINUTES,
  HOUR_MINUTES,
  TWO_HOURS_MINUTES,
] as const;

const NO_RECHECK_TEXT =
  "No re-check time fits before the decision deadline, so this cannot be deferred.";

/** Re-check offsets that land before the deadline; none left means the decision cannot be deferred. */
function fittingRecheckMinutes(decideBy: string, now: number): number[] {
  const remainingMinutes = (Date.parse(decideBy) - now) / MS_PER_MINUTE;
  return RECHECK_MINUTES.filter((minutes) => minutes < remainingMinutes);
}

export { fittingRecheckMinutes, NO_RECHECK_TEXT };
