import { type JSX, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import type {
  EvaluatedStanding,
  StandingPosture,
} from "@/features/map/load-map";
import { effectivePosture } from "./decision-status";
import { POSTURE_CLASSES, POSTURE_LABELS } from "./posture";

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const OVERDUE_TEXT = "Decision overdue";
const AS_OF_PREFIX = "As of";
const RECOMMENDED_PREFIX = "Recommended:";
/** A fixed zone, so the server and the browser format the same text. */
const AS_OF_FORMAT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

/** Ticks on wall-clock minute boundaries, so the countdown turns over with the clock. */
function subscribeToMinutes(onMinute: () => void): () => void {
  let interval: ReturnType<typeof setInterval> | undefined;
  const untilNextMinute = MS_PER_MINUTE - (Date.now() % MS_PER_MINUTE);
  const timeout = setTimeout((): void => {
    onMinute();
    interval = setInterval(onMinute, MS_PER_MINUTE);
  }, untilNextMinute);
  return (): void => {
    clearTimeout(timeout);
    clearInterval(interval);
  };
}

/** Floored to the minute, so the snapshot stays stable between ticks. */
function currentMinute(): number {
  return Math.floor(Date.now() / MS_PER_MINUTE) * MS_PER_MINUTE;
}

/** The server has no "now" that matches the browser's, so it renders none. */
function noMinute(): null {
  return null;
}

function countdownText(decideBy: string, now: number): string {
  const remainingMs = Date.parse(decideBy) - now;
  if (remainingMs <= 0) {
    return OVERDUE_TEXT;
  }
  const totalMinutes = Math.ceil(remainingMs / MS_PER_MINUTE);
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  if (hours === 0) {
    return `Decide in ${minutes} min`;
  }
  return `Decide in ${hours} h ${minutes} min`;
}

function PostureBadge({ posture }: { posture: StandingPosture }): JSX.Element {
  return (
    <Badge className={POSTURE_CLASSES[posture]}>
      {POSTURE_LABELS[posture]}
    </Badge>
  );
}

function DecideByCountdown({ decideBy }: { decideBy: string }): JSX.Element {
  const now = useSyncExternalStore<number | null>(
    subscribeToMinutes,
    currentMinute,
    noMinute,
  );
  return (
    <time className="text-xs" dateTime={decideBy}>
      {now !== null && countdownText(decideBy, now)}
    </time>
  );
}

/** When the standing was evaluated, so a reader can judge how fresh it is. */
function AsOfMarker({ asOf }: { asOf: string }): JSX.Element {
  return (
    <p className="text-muted-foreground text-xs">
      {AS_OF_PREFIX}{" "}
      <time dateTime={asOf}>{AS_OF_FORMAT.format(Date.parse(asOf))}</time>
    </p>
  );
}

function RecommendedPosture({
  standing,
}: {
  standing: EvaluatedStanding;
}): JSX.Element | null {
  if (effectivePosture(standing) === standing.posture) {
    return null;
  }
  return (
    <span className="text-muted-foreground text-xs">
      {`${RECOMMENDED_PREFIX} ${POSTURE_LABELS[standing.posture]}`}
    </span>
  );
}

export { AsOfMarker, DecideByCountdown, PostureBadge, RecommendedPosture };
