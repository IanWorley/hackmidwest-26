import type {
  Decision,
  DirectiveKind,
  HumanAction,
  Posture,
  ReasonCategory,
} from "./decision-api";

export const POSTURE_LABELS: Record<Posture, string> = {
  normal: "Normal operations",
  delayed_arrival: "Delayed arrival",
  early_dismissal: "Early dismissal",
  unscheduled_telework: "Unscheduled telework",
  full_closure: "Full closure",
};

/** Theme tokens from styles.css; the label always shows with the color. */
export const POSTURE_CLASSES: Record<Posture, string> = {
  normal: "bg-posture-normal text-posture-normal-foreground",
  delayed_arrival:
    "bg-posture-delayed-arrival text-posture-delayed-arrival-foreground",
  early_dismissal:
    "bg-posture-early-dismissal text-posture-early-dismissal-foreground",
  unscheduled_telework:
    "bg-posture-unscheduled-telework text-posture-unscheduled-telework-foreground",
  full_closure: "bg-posture-full-closure text-posture-full-closure-foreground",
};

export const ACTION_LABELS: Record<Decision["action"], string> = {
  accept: "Accepted",
  override: "Overrode",
  defer: "Deferred",
  no_decision: "No decision",
};

export const ACTION_BUTTON_LABELS: Record<HumanAction, string> = {
  accept: "Accept",
  override: "Override",
  defer: "Defer",
};

export const REASON_CATEGORY_LABELS: Record<ReasonCategory, string> = {
  local_conditions: "Local conditions",
  road_reports: "Road reports",
  directive: "Directive from leadership",
  essential_operations: "Essential operations",
  data_looks_wrong: "Data looks wrong",
  other: "Other",
};

export const DIRECTIVE_KIND_LABELS: Record<DirectiveKind, string> = {
  report: "Report on site",
  telework: "Telework",
  dismissed: "Dismissed",
  excused: "Excused",
};

/** Option lists keep the label map's key type; the map's literal keys are exactly `Key`. */
export function labeledOptions<Key extends string>(
  labels: Record<Key, string>,
): { readonly value: Key; readonly label: string }[] {
  const keys = Object.keys(labels) as Key[];
  return keys.map((value) => ({ value, label: labels[value] }));
}

/** Reads a submitted form value back into the label map's key type. */
export function parseOption<Key extends string>(
  labels: Record<Key, string>,
  value: FormDataEntryValue | null,
): Key | undefined {
  return labeledOptions(labels).find((option) => option.value === value)?.value;
}
