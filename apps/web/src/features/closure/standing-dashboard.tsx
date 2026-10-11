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
import {
  awaitsDecision,
  DECISION_STATUSES,
  decisionDeadline,
  decisionOnRecommendation,
  effectivePosture,
} from "./decision-status";
import {
  AsOfMarker,
  DecideByCountdown,
  PostureBadge,
  RecommendedPosture,
} from "./posture-fields";

const TABLE_NAME = "Facility standing";
const FACILITY_COLUMN = "Facility";
const POSTURE_COLUMN = "Posture";
const DECIDE_BY_COLUMN = "Decide by";
const DECISION_COLUMN = "Decision";
const NOTHING_TO_SHOW_TEXT = "—";
const DECISIONS_NEEDED_LABEL = "Decisions needed";
const DECISION_NEEDED_TEXT = "Decision needed";

/** A recommendation exists and nobody has settled it: no decision on it yet, a deferral, or a missed deadline. */
function needsDecision(standing: Standing): boolean {
  return standing.posture !== "not_evaluated" && awaitsDecision(standing);
}

/**
 * The status of the shown recommendation, not of the facility's current decision: after a same-day re-evaluation the
 * earlier decision still sets the posture, but the new recommendation still needs its own.
 */
function decisionText(standing: Standing): string {
  if (standing.posture === "not_evaluated") {
    return NOTHING_TO_SHOW_TEXT;
  }
  const decision = decisionOnRecommendation(standing);
  if (decision === null) {
    return DECISION_NEEDED_TEXT;
  }
  return DECISION_STATUSES[decision.action].label;
}

/** The deadline still matters until someone decides; a deferral counts down to its recheck time. */
function DecideByCell({ standing }: { standing: Standing }): JSX.Element {
  if (standing.posture === "not_evaluated" || !awaitsDecision(standing)) {
    return <>{NOTHING_TO_SHOW_TEXT}</>;
  }
  return <DecideByCountdown decideBy={decisionDeadline(standing)} />;
}

function PostureDetails({ standing }: { standing: Standing }): JSX.Element {
  if (standing.posture === "not_evaluated") {
    return <PostureBadge posture={standing.posture} />;
  }
  return (
    <>
      <PostureBadge posture={effectivePosture(standing)} />
      <RecommendedPosture standing={standing} />
      <AsOfMarker asOf={standing.asOf} />
    </>
  );
}

/** One line per part, so the posture in effect and the recommendation never run together. */
function PostureCell({ standing }: { standing: Standing }): JSX.Element {
  return (
    <div className="flex flex-col items-start gap-1">
      <PostureDetails standing={standing} />
    </div>
  );
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
        <PostureCell standing={standing} />
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
