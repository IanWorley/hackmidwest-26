import type { StandingPosture } from "@/features/map/load-map";

/** Legend order, from business as usual to the most disruptive, then unknown. */
const STANDING_POSTURES = [
  "normal",
  "delayed_arrival",
  "early_dismissal",
  "unscheduled_telework",
  "full_closure",
  "not_evaluated",
] as const satisfies readonly StandingPosture[];

const POSTURE_LABELS: Record<StandingPosture, string> = {
  normal: "Normal operations",
  delayed_arrival: "Delayed arrival",
  early_dismissal: "Early dismissal",
  unscheduled_telework: "Unscheduled telework",
  full_closure: "Full closure",
  not_evaluated: "Not evaluated",
};

/** Literal class names, so Tailwind generates them. */
const POSTURE_CLASSES: Record<StandingPosture, string> = {
  normal: "bg-posture-normal text-posture-normal-foreground",
  delayed_arrival:
    "bg-posture-delayed-arrival text-posture-delayed-arrival-foreground",
  early_dismissal:
    "bg-posture-early-dismissal text-posture-early-dismissal-foreground",
  unscheduled_telework:
    "bg-posture-unscheduled-telework text-posture-unscheduled-telework-foreground",
  full_closure: "bg-posture-full-closure text-posture-full-closure-foreground",
  not_evaluated:
    "bg-posture-not-evaluated text-posture-not-evaluated-foreground",
};

export { POSTURE_CLASSES, POSTURE_LABELS, STANDING_POSTURES };
