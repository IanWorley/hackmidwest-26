import type { Recommendation } from "./notification-api";

type Posture = Recommendation["posture"];

export const POSTURE_LABELS: Record<Posture, string> = {
  normal: "Normal operations",
  delayed_arrival: "Delayed arrival",
  early_dismissal: "Early dismissal",
  unscheduled_telework: "Unscheduled telework",
  full_closure: "Full closure",
};
