import type {
  Decision,
  DirectiveKind,
  HumanAction,
  Posture,
  ReasonCategory,
  Recommendation,
} from "./decision-api";
import type { Hazard } from "./load-facilities";

type WindMetric = Extract<
  Recommendation["snapshot"]["output"]["findings"][number]["margin"],
  { unit: "mph" }
>["metric"];

const WIND_METRIC_LABELS: Record<WindMetric, string> = {
  wind_sustained: "Sustained wind",
  wind_gust: "Gusts",
};

const HAZARD_LABELS: Record<Hazard, string> = {
  winter: "Winter storm",
  wind: "High wind",
  airQuality: "Air quality",
  flood: "Flood",
};

const POSTURE_LABELS: Record<Posture, string> = {
  normal: "Normal operations",
  delayed_arrival: "Delayed arrival",
  early_dismissal: "Early dismissal",
  unscheduled_telework: "Unscheduled telework",
  full_closure: "Full closure",
};

/** Theme tokens from styles.css; the label always shows with the color. */
const POSTURE_CLASSES: Record<Posture, string> = {
  normal: "bg-posture-normal text-posture-normal-foreground",
  delayed_arrival:
    "bg-posture-delayed-arrival text-posture-delayed-arrival-foreground",
  early_dismissal:
    "bg-posture-early-dismissal text-posture-early-dismissal-foreground",
  unscheduled_telework:
    "bg-posture-unscheduled-telework text-posture-unscheduled-telework-foreground",
  full_closure: "bg-posture-full-closure text-posture-full-closure-foreground",
};

const ACTION_LABELS: Record<Decision["action"], string> = {
  accept: "Accepted",
  override: "Overrode",
  defer: "Deferred",
  no_decision: "No decision",
};

const ACTION_BUTTON_LABELS: Record<HumanAction, string> = {
  accept: "Accept",
  override: "Override",
  defer: "Defer",
};

const REASON_CATEGORY_LABELS: Record<ReasonCategory, string> = {
  local_conditions: "Local conditions",
  road_reports: "Road reports",
  directive: "Directive from leadership",
  essential_operations: "Essential operations",
  data_looks_wrong: "Data looks wrong",
  other: "Other",
};

const DIRECTIVE_KIND_LABELS: Record<DirectiveKind, string> = {
  report: "Report on site",
  telework: "Telework",
  dismissed: "Dismissed",
  excused: "Excused",
};

function isLabelKey<Key extends string>(
  labels: Record<Key, string>,
  key: string,
): key is Key {
  return Object.hasOwn(labels, key);
}

/** Option lists keep the label map's key type, in the map's own order. */
function labeledOptions<Key extends string>(
  labels: Record<Key, string>,
): { readonly value: Key; readonly label: string }[] {
  return Object.keys(labels)
    .filter((key) => isLabelKey(labels, key))
    .map((value) => ({ value, label: labels[value] }));
}

function parseOption<Key extends string>(
  labels: Record<Key, string>,
  value: FormDataEntryValue | null,
): Key | undefined {
  if (typeof value === "string" && isLabelKey(labels, value)) {
    return value;
  }
  return undefined;
}

export {
  ACTION_BUTTON_LABELS,
  ACTION_LABELS,
  DIRECTIVE_KIND_LABELS,
  HAZARD_LABELS,
  labeledOptions,
  POSTURE_CLASSES,
  POSTURE_LABELS,
  parseOption,
  REASON_CATEGORY_LABELS,
  WIND_METRIC_LABELS,
};
