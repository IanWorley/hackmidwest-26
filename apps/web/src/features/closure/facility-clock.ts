const LOCALE = "en-CA";

const CLOCK_FORMAT = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
} as const satisfies Intl.DateTimeFormatOptions;

function part(
  parts: readonly Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPart["type"],
): string {
  return parts.find((candidate) => candidate.type === type)?.value ?? "";
}

/** `HH:MM` in the facility's zone, with the local date added only when it falls off the facility day. */
export function facilityClock(
  instant: string,
  timeZone: string,
  facilityDate: string,
): string {
  const parts = new Intl.DateTimeFormat(LOCALE, {
    ...CLOCK_FORMAT,
    timeZone,
  }).formatToParts(new Date(instant));
  const time = `${part(parts, "hour")}:${part(parts, "minute")}`;
  const date = `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`;
  if (date === facilityDate) {
    return time;
  }
  return `${time} ${date}`;
}
