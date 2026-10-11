const GOOD_MAX = 50;
const MODERATE_MAX = 100;
const UNHEALTHY_FOR_SENSITIVE_GROUPS_MAX = 150;
const UNHEALTHY_MAX = 200;
const VERY_UNHEALTHY_MAX = 300;

interface AqiCategory {
  readonly label: string;
  /** Literal Tailwind classes, so the build sees them. */
  readonly ringClassName: string;
}

interface BoundedAqiCategory extends AqiCategory {
  readonly max: number;
}

/** EPA AQI categories in ascending order; anything above the last bound is hazardous. */
const BOUNDED_AQI_CATEGORIES: readonly BoundedAqiCategory[] = [
  { max: GOOD_MAX, label: "Good", ringClassName: "ring-green-500" },
  { max: MODERATE_MAX, label: "Moderate", ringClassName: "ring-yellow-400" },
  {
    max: UNHEALTHY_FOR_SENSITIVE_GROUPS_MAX,
    label: "Unhealthy for sensitive groups",
    ringClassName: "ring-orange-500",
  },
  { max: UNHEALTHY_MAX, label: "Unhealthy", ringClassName: "ring-red-600" },
  {
    max: VERY_UNHEALTHY_MAX,
    label: "Very unhealthy",
    ringClassName: "ring-purple-700",
  },
];

const HAZARDOUS: AqiCategory = {
  label: "Hazardous",
  ringClassName: "ring-rose-950",
};

export function aqiCategory(value: number): AqiCategory {
  return (
    BOUNDED_AQI_CATEGORIES.find((category) => value <= category.max) ??
    HAZARDOUS
  );
}
