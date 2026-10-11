import { type JSX, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import type { StandingPosture } from "@/features/map/load-map";
import { POSTURE_CLASSES, POSTURE_LABELS } from "./posture";

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const OVERDUE_TEXT = "Decision overdue";
const AS_OF_PREFIX = "As of";
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

/** Ticks every second, so a deadline at any instant, such as a deferral's mid-minute recheck, turns over within a second. */
function subscribeToSeconds(onSecond: () => void): () => void {
  const interval = setInterval(onSecond, MS_PER_SECOND);
  return (): void => clearInterval(interval);
}

/** Floored to the second, so the snapshot stays stable between ticks. */
function currentSecond(): number {
  return Math.floor(Date.now() / MS_PER_SECOND) * MS_PER_SECOND;
}

/** The server has no "now" that matches the browser's, so it renders none. */
function noNow(): null {
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
    subscribeToSeconds,
    currentSecond,
    noNow,
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

export { AsOfMarker, DecideByCountdown, PostureBadge };
