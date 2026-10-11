const LOCALE = "en-US";

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
