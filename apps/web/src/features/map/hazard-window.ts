const HAZARD_WINDOW_SEPARATOR = " → ";
/** A fixed zone, so the server and the browser format the same text. */
const HAZARD_TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

/** An alert's onset → ends, as one line. */
export function hazardWindowText(onset: string, ends: string): string {
  return `${HAZARD_TIME_FORMAT.format(Date.parse(onset))}${HAZARD_WINDOW_SEPARATOR}${HAZARD_TIME_FORMAT.format(Date.parse(ends))}`;
}
