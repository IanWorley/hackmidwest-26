const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;

function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  if (hours === 0) {
    return `${minutes} min`;
  }
  return `${hours} h ${minutes} min`;
}

/** Whole minutes only, so a polite live region speaks at most once a minute. */
export function formatCountdown(decideByMs: number, nowMs: number): string {
  const remainingMs = decideByMs - nowMs;
  if (remainingMs <= -MS_PER_MINUTE) {
    return `Decision deadline passed ${formatDuration(Math.floor(-remainingMs / MS_PER_MINUTE))} ago`;
  }
  if (remainingMs <= 0) {
    return "Decision deadline just passed";
  }
  if (remainingMs < MS_PER_MINUTE) {
    return "Less than a minute left to decide";
  }
  return `${formatDuration(Math.floor(remainingMs / MS_PER_MINUTE))} left to decide`;
}
