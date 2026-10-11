import type { JSX } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Decision } from "./decision-api";
import { formatFacilityTime } from "./format-time";
import {
  ACTION_LABELS,
  POSTURE_LABELS,
  REASON_CATEGORY_LABELS,
} from "./labels";

const HISTORY_HEADING = "Decision history";
const EMPTY_TEXT = "No decisions recorded for this facility yet.";
const WHEN_COLUMN = "Recorded";
const ACTION_COLUMN = "Action";
const POSTURE_COLUMN = "Posture";
const BY_COLUMN = "Recorded by";
const REASON_COLUMN = "Reason";
const TIMING_COLUMN = "Before deadline";
const UNVERIFIED_SUFFIX = "(unverified)";
const RECHECK_LABEL = "re-check";
const NO_POSTURE = "None";
const NO_REASON = "None given";
const REPORTED_LABEL = "reported";
const BACKUP_TITLE = "Nobody decided before the deadline.";
const BACKUP_PREFIX = "The backup decision maker is";
const MINUTES_EARLY_SUFFIX = "min early";
const MINUTES_LATE_SUFFIX = "min late";

function timingText(minutesBeforeDecideBy: number): string {
  if (minutesBeforeDecideBy < 0) {
    return `${-minutesBeforeDecideBy} ${MINUTES_LATE_SUFFIX}`;
  }
  return `${minutesBeforeDecideBy} ${MINUTES_EARLY_SUFFIX}`;
}

function postureText(decision: Decision, timeZone: string): string {
  if (decision.chosenPosture !== null) {
    return POSTURE_LABELS[decision.chosenPosture];
  }
  if (decision.recheckAt !== null) {
    return `${RECHECK_LABEL} ${formatFacilityTime(decision.recheckAt, timeZone)}`;
  }
  return NO_POSTURE;
}

function reasonText(decision: Decision): string {
  if (decision.reasonCategory === null || decision.reasonText === null) {
    return NO_REASON;
  }
  return `${REASON_CATEGORY_LABELS[decision.reasonCategory]}: ${decision.reasonText}`;
}

/** The API records a missed deadline as a `no_decision` row naming the backup, so the newest such row is who to call. */
function BackupNotice({
  history,
}: {
  history: readonly Decision[];
}): JSX.Element | null {
  const [newest] = history;
  if (newest?.action !== "no_decision") {
    return null;
  }
  return (
    <Alert role="alert">
      <AlertTitle>{BACKUP_TITLE}</AlertTitle>
      <AlertDescription>
        {`${BACKUP_PREFIX} ${newest.decidedByName}, ${newest.decidedByRole}.`}
      </AlertDescription>
    </Alert>
  );
}

function HistoryTable({
  history,
  timeZone,
}: {
  history: readonly Decision[];
  timeZone: string;
}): JSX.Element {
  return (
    <Table aria-label={HISTORY_HEADING}>
      <TableHeader>
        <TableRow>
          <TableHead>{WHEN_COLUMN}</TableHead>
          <TableHead>{ACTION_COLUMN}</TableHead>
          <TableHead>{POSTURE_COLUMN}</TableHead>
          <TableHead>{BY_COLUMN}</TableHead>
          <TableHead>{REASON_COLUMN}</TableHead>
          <TableHead>{TIMING_COLUMN}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {history.map((decision) => (
          <TableRow key={decision.id}>
            <TableCell>
              {formatFacilityTime(decision.decidedAt, timeZone)}
            </TableCell>
            <TableCell>{ACTION_LABELS[decision.action]}</TableCell>
            <TableCell>{postureText(decision, timeZone)}</TableCell>
            <TableCell>
              {`${decision.decidedByName}, ${decision.decidedByRole} ${UNVERIFIED_SUFFIX}`}
            </TableCell>
            <TableCell className="whitespace-normal">
              <p>{reasonText(decision)}</p>
              {decision.humanInputs.map((input) => (
                <p className="text-muted-foreground" key={input.id}>
                  {`${input.reportedBy} ${REPORTED_LABEL}: ${input.text}`}
                </p>
              ))}
            </TableCell>
            <TableCell>{timingText(decision.minutesBeforeDecideBy)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function DecisionHistory({
  history,
  timeZone,
}: {
  history: readonly Decision[];
  timeZone: string;
}): JSX.Element {
  let content = <HistoryTable history={history} timeZone={timeZone} />;
  if (history.length === 0) {
    content = <p className="text-muted-foreground">{EMPTY_TEXT}</p>;
  }
  return (
    <section className="space-y-2">
      <h2 className="font-heading font-semibold text-xl">{HISTORY_HEADING}</h2>
      {content}
    </section>
  );
}

export { BackupNotice, DecisionHistory };
