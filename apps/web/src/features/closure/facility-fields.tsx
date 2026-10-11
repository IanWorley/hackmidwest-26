import type { JSX } from "react";
import { Badge } from "@/components/ui/badge";
import type { Facility, Hazard } from "./load-facilities";

const HOURS_SEPARATOR = "–";

const HAZARD_LABELS: Record<Hazard, string> = {
  winter: "Winter storm",
  wind: "High wind",
  airQuality: "Air quality",
  flood: "Flood",
};

export function FacilityHours({
  facility,
}: {
  facility: Pick<Facility, "opensAt" | "closesAt">;
}): JSX.Element {
  return <>{`${facility.opensAt}${HOURS_SEPARATOR}${facility.closesAt}`}</>;
}

export function HazardBadges({
  hazards,
}: {
  hazards: readonly Hazard[];
}): JSX.Element {
  return (
    <ul className="flex flex-wrap gap-1">
      {hazards.map((hazard) => (
        <li key={hazard}>
          <Badge variant="secondary">{HAZARD_LABELS[hazard]}</Badge>
        </li>
      ))}
    </ul>
  );
}
