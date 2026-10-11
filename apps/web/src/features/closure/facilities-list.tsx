import { Link } from "@tanstack/react-router";
import type { JSX } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FacilityHours, HazardBadges } from "./facility-fields";
import type { Facilities, Facility } from "./load-facilities";

const FACILITY_COLUMN = "Facility";
const TIME_ZONE_COLUMN = "Time zone";
const HOURS_COLUMN = "Hours";
const HAZARDS_COLUMN = "Hazards";

function FacilityRow({ facility }: { facility: Facility }): JSX.Element {
  return (
    <TableRow>
      <TableCell>
        <Link
          className="font-medium underline-offset-4 hover:underline"
          params={{ facilityId: String(facility.id) }}
          to="/facilities/$facilityId"
        >
          {facility.name}
        </Link>
      </TableCell>
      <TableCell>{facility.timezone}</TableCell>
      <TableCell>
        <FacilityHours facility={facility} />
      </TableCell>
      <TableCell>
        <HazardBadges hazards={facility.hazards} />
      </TableCell>
    </TableRow>
  );
}

export function FacilitiesList({
  facilities,
}: {
  facilities: Facilities;
}): JSX.Element {
  return (
    <Table aria-label="Facilities">
      <TableHeader>
        <TableRow>
          <TableHead>{FACILITY_COLUMN}</TableHead>
          <TableHead>{TIME_ZONE_COLUMN}</TableHead>
          <TableHead>{HOURS_COLUMN}</TableHead>
          <TableHead>{HAZARDS_COLUMN}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {facilities.map((facility) => (
          <FacilityRow facility={facility} key={facility.id} />
        ))}
      </TableBody>
    </Table>
  );
}
