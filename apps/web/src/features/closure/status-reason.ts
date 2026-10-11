import {
  type EffectiveStatus,
  type Person,
  POSTURE_LABELS,
  STATUS_LABELS,
} from "./roster-filter";

const CLOCK_LOCALE = "en-US";
const BASELINE_CAUSE = "baseline";
const DIRECTIVE_PREFIX = "directive: ";
const MINUTES_SUFFIX = " min";
const SCHEDULED_PREFIX = "then";
/** Facility dates are calendar days, so they format in UTC to avoid shifting a day. */
const CALENDAR_ZONE = "UTC";

function timingOf(
  effective: EffectiveStatus,
  timeZone: string,
): string | undefined {
  if (effective.kind === "delayed_arrival") {
    return `${effective.delayMinutes}${MINUTES_SUFFIX}`;
  }
  if (effective.kind === "dismissed" && effective.release !== "all_day") {
    return formatClock(effective.release.at, timeZone);
  }
  return undefined;
}

function withTiming(text: string, timing: string | undefined): string {
  if (timing === undefined) {
    return text;
  }
  return `${text} ${timing}`;
}

/** A 24-hour wall-clock time at the facility, such as `13:30`. */
export function formatClock(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat(CLOCK_LOCALE, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
}

/**
 * One line saying what a person does today and why, such as `dismissed, early dismissal 13:30`.
 * A not-working note from the person's own status already says why, so it stands in for the cause.
 * A directive always names itself, so an excused person never reads like someone on leave.
 */
export function formatStatusReason(
  effective: EffectiveStatus,
  timeZone: string,
): string {
  const status = STATUS_LABELS[effective.kind];
  if (
    effective.kind === "not_working" &&
    effective.cause.source !== "directive"
  ) {
    return `${status}, ${effective.note}`;
  }
  const timing = timingOf(effective, timeZone);
  const { cause } = effective;
  if (cause.source === "posture") {
    return `${status}, ${withTiming(POSTURE_LABELS[cause.posture], timing)}`;
  }
  if (cause.source === "directive") {
    return `${withTiming(status, timing)}, ${DIRECTIVE_PREFIX}${cause.directive.reasonText}`;
  }
  return `${withTiming(status, timing)}, ${BASELINE_CAUSE}`;
}

/** A calendar day such as `Mon, Oct 12`, read from a `YYYY-MM-DD` facility date. */
export function formatFacilityDay(facilityDate: string): string {
  return new Intl.DateTimeFormat(CLOCK_LOCALE, {
    timeZone: CALENDAR_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${facilityDate}T00:00:00Z`));
}

/** The status a person is scheduled to move to next, such as `then not working from Fri, Oct 16, 2026 14:00`. */
export function formatScheduled(
  person: Person,
  timeZone: string,
): string | undefined {
  const { nextEvent } = person;
  if (nextEvent === null) {
    return undefined;
  }
  const day = new Intl.DateTimeFormat(CLOCK_LOCALE, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(nextEvent.effectiveFrom));
  return `${SCHEDULED_PREFIX} ${STATUS_LABELS[nextEvent.status]} from ${day} ${formatClock(nextEvent.effectiveFrom, timeZone)}`;
}
