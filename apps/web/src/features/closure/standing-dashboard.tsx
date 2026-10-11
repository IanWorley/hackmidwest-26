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
import type { MapFacility, Standing } from "@/features/map/load-map";
import { needsDecision } from "./dashboard";
import { AsOfMarker, DecideByCountdown, PostureBadge } from "./posture-fields";

const TABLE_NAME = "Facility standing";
const FACILITY_COLUMN = "Facility";
const POSTURE_COLUMN = "Posture";
const DECIDE_BY_COLUMN = "Decide by";
const DECISION_COLUMN = "Decision";
const NOTHING_TO_SHOW_TEXT = "—";
const DECISIONS_NEEDED_LABEL = "Decisions needed";
const DECISION_NEEDED_TEXT = "Decision needed";
const DECISION_RECORDED_TEXT = "Decision recorded";

type DecisionText =
  | typeof NOTHING_TO_SHOW_TEXT
  | typeof DECISION_NEEDED_TEXT
  | typeof DECISION_RECORDED_TEXT;

function decisionText(standing: Standing): DecisionText {
  if (standing.posture === "not_evaluated") {
    return NOTHING_TO_SHOW_TEXT;
  }
  if (needsDecision(standing)) {
    return DECISION_NEEDED_TEXT;
  }
  return DECISION_RECORDED_TEXT;
}

/** A recorded decision has no deadline left to count down to. */
function DecideByCell({ standing }: { standing: Standing }): JSX.Element {
  if (!needsDecision(standing)) {
    return <>{NOTHING_TO_SHOW_TEXT}</>;
  }
  return <DecideByCountdown decideBy={standing.decideBy} />;
}

function StandingRow({ facility }: { facility: MapFacility }): JSX.Element {
  const { standing } = facility;
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
      <TableCell>
        <PostureBadge posture={standing.posture} />
        {standing.posture !== "not_evaluated" && (
          <AsOfMarker asOf={standing.asOf} mode={standing.mode} />
        )}
      </TableCell>
      <TableCell>
        <DecideByCell standing={standing} />
      </TableCell>
      <TableCell>{decisionText(standing)}</TableCell>
    </TableRow>
  );
}

export function StandingDashboard({
  facilities,
}: {
  facilities: readonly MapFacility[];
}): JSX.Element {
  const decisionsNeeded = facilities.filter((facility) =>
    needsDecision(facility.standing),
  ).length;
  return (
    <div className="space-y-4">
      <p className="font-medium" role="status">
        {`${DECISIONS_NEEDED_LABEL}: ${decisionsNeeded}`}
      </p>
      <Table aria-label={TABLE_NAME}>
        <TableHeader>
          <TableRow>
            <TableHead>{FACILITY_COLUMN}</TableHead>
            <TableHead>{POSTURE_COLUMN}</TableHead>
            <TableHead>{DECIDE_BY_COLUMN}</TableHead>
            <TableHead>{DECISION_COLUMN}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {facilities.map((facility) => (
            <StandingRow facility={facility} key={facility.id} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
