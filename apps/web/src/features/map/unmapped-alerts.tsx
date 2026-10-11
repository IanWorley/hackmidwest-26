import type { JSX } from "react";
import { hazardWindowText } from "./hazard-window";
import type { AlertFeature } from "./load-map";

const LIST_NAME = "Alerts without a mapped area";

/** NWS sometimes gives an alert no outline, and no zone outline resolves; it still applies, so list it. */
export function UnmappedAlerts({
  alerts,
}: {
  alerts: readonly AlertFeature[];
}): JSX.Element | null {
  const unmapped = alerts.filter(({ geometry }) => geometry === null);
  if (unmapped.length === 0) {
    return null;
  }
  return (
    <section className="space-y-1 text-sm">
      <h2 className="font-medium">{LIST_NAME}</h2>
      <ul aria-label={LIST_NAME} className="list-disc pl-5">
        {unmapped.map(({ id, properties }) => (
          <li key={id}>
            {`${properties.event}, ${hazardWindowText(properties.onset, properties.ends)}`}
          </li>
        ))}
      </ul>
    </section>
  );
}
