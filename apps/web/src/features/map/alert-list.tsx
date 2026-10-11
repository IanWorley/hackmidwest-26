import type { JSX } from "react";
import { hazardWindowText } from "./hazard-window";
import type { AlertFeature } from "./load-map";

const LIST_NAME = "Active alerts";
const UNMAPPED_SUFFIX = " (no mapped area)";

function alertText({ geometry, properties }: AlertFeature): string {
  const text = `${properties.event}, ${hazardWindowText(properties.onset, properties.ends)}`;
  if (geometry === null) {
    return `${text}${UNMAPPED_SUFFIX}`;
  }
  return text;
}

/** Every alert the map draws, as text, so keyboard and screen-reader users reach what the hover tooltips show; alerts with no outline appear only here. */
export function AlertList({
  alerts,
}: {
  alerts: readonly AlertFeature[];
}): JSX.Element | null {
  if (alerts.length === 0) {
    return null;
  }
  return (
    <section className="space-y-1 text-sm">
      <h2 className="font-medium">{LIST_NAME}</h2>
      <ul aria-label={LIST_NAME} className="list-disc pl-5">
        {alerts.map((alert) => (
          <li key={alert.id}>{alertText(alert)}</li>
        ))}
      </ul>
    </section>
  );
}
