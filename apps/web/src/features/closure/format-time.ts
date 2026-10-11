const LOCALE = "en-US";
const DATE_ONLY_ZONE = "UTC";

/** Every instant on the decision screen reads in the facility's own time zone, on the server and in the browser alike. */
export function formatFacilityTime(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(new Date(instant));
}

/** A facility day such as `2026-10-10` as `Sat, Oct 10`; read in UTC so the date never shifts a day. */
export function formatFacilityDate(date: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: DATE_ONLY_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
}
