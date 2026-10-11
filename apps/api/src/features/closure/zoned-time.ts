const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;
const TIME_PART_WIDTH = 2;

declare const instantBrand: unique symbol;
/** UTC epoch milliseconds. Internal to the closure engine: its public surface speaks ISO strings. */
type Instant = number & { readonly [instantBrand]: true };

interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

interface WallClock extends CalendarDate {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

function isInstant(ms: number): ms is Instant {
  return Number.isFinite(ms);
}

function toInstant(ms: number): Instant {
  if (!isInstant(ms)) {
    throw new RangeError(`Not a finite epoch millisecond value: ${ms}`);
  }
  return ms;
}

function parseInstant(iso: string): Instant {
  return toInstant(Date.parse(iso));
}

function toIso(at: Instant): string {
  return new Date(at).toISOString();
}

/**
 * A `HH:MM` wall time on `date` in `zone`, as an instant. The offset is sampled twice because a
 * DST transition can lie between the wall time read as UTC and the true instant. A wall time the
 * spring-forward gap skips resolves forward; a repeated fall-back time resolves to the earlier one.
 */
function localInstant(date: CalendarDate, time: string, zone: string): Instant {
  const [hours, minutes] = time.split(":");
  const wall = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    Number(hours),
    Number(minutes),
  );
  const first = wall - zoneOffset(toInstant(wall), zone);
  const second = wall - zoneOffset(toInstant(first), zone);
  if (zoneOffset(toInstant(second), zone) === wall - second) {
    return toInstant(second);
  }
  return toInstant(first);
}

/** Milliseconds `zone`'s wall clock is ahead of UTC at `at`; negative west of Greenwich. */
function zoneOffset(at: Instant, zone: string): number {
  const wall = wallClock(at, zone);
  const wallAsUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  return wallAsUtc - Math.floor(at / MS_PER_SECOND) * MS_PER_SECOND;
}

function wallClock(at: Instant, zone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(at);
  function part(type: Intl.DateTimeFormatPartTypes): number {
    return Number(parts.find((candidate) => candidate.type === type)?.value);
  }
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    second: part("second"),
  };
}

function calendarDate(at: Instant, zone: string): CalendarDate {
  const { year, month, day } = wallClock(at, zone);
  return { year, month, day };
}

function addDays(date: CalendarDate, days: number): CalendarDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

/** `YYYY-MM-DD`. */
function formatDate({ year, month, day }: CalendarDate): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The inverse of formatDate. A malformed date yields NaN fields, which localInstant rejects. */
function parseCalendarDate(text: string): CalendarDate {
  const [year, month, day] = text.split("-");
  return { year: Number(year), month: Number(month), day: Number(day) };
}

/** `HH:MM` on `zone`'s wall clock. */
function formatTimeOfDay(at: Instant, zone: string): string {
  const { hour, minute } = wallClock(at, zone);
  return `${pad(hour)}:${pad(minute)}`;
}

function pad(value: number): string {
  return String(value).padStart(TIME_PART_WIDTH, "0");
}

export type { CalendarDate, Instant };
export {
  addDays,
  calendarDate,
  formatDate,
  formatTimeOfDay,
  localInstant,
  MS_PER_MINUTE,
  parseCalendarDate,
  parseInstant,
  toInstant,
  toIso,
};
