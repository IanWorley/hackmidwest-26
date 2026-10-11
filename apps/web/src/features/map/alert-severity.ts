import type { AlertSeverity } from "./load-map";

/** Literal class names, so Tailwind generates them; CSS fill and stroke override Leaflet's SVG attributes. */
const ALERT_SEVERITY_CLASSES: Record<AlertSeverity, string> = {
  Extreme: "fill-purple-700 stroke-purple-800",
  Severe: "fill-red-600 stroke-red-700",
  Moderate: "fill-orange-500 stroke-orange-600",
  Minor: "fill-yellow-400 stroke-yellow-500",
  Unknown: "fill-slate-400 stroke-slate-500",
};

export { ALERT_SEVERITY_CLASSES };
