import { type JSX, useCallback, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { facilityClock } from "./facility-clock";
import type {
  DecisionNotifications,
  DispatchResult,
  NotificationConflict,
} from "./notification-api";
import { CHANNEL_LABELS } from "./notification-labels";
import { NotificationRecipients } from "./notification-recipients";

type PanelState =
  | { readonly kind: "ready" }
  | { readonly kind: "dispatching" }
  | { readonly kind: "conflict"; readonly conflict: NotificationConflict }
  /** No clear answer came back, so the dispatch may have landed; the screen reloads to find out. */
  | { readonly kind: "checking" }
  | { readonly kind: "unconfirmed" }
  | { readonly kind: "failed" };

const DISPATCH_LABEL = "Dispatch notifications";
const DISPATCHED_LABEL = "Dispatched notices";
const CHECKING_TEXT =
  "The dispatch got no clear answer. Checking whether it was recorded…";
const UNCONFIRMED_TEXT =
  "The dispatch got no clear answer. The screen is reloaded with what was recorded; if no dispatched notices are listed, try again.";
const FAILED_TEXT =
  "The dispatch got no clear answer, and the screen could not be reloaded to check it. Reload the page before trying again.";
const NAME_COLUMN = "Name";
const CHANNEL_COLUMN = "Channel";
const RECORDED_COLUMN = "Recorded at";
const LEAD_TIME_COLUMN = "Lead time";
const AFTER_SEND_BY_TEXT = "After send-by";
const UNKNOWN_RECIPIENT = "Unknown recipient";
const READY: PanelState = { kind: "ready" };
/** Kinds that wait on the server; another click now could dispatch twice. */
const BUSY_KINDS: readonly PanelState["kind"][] = ["dispatching", "checking"];

/** What this panel did itself, tied to the decision it did it for, so a reloaded decision starts fresh. */
interface LocalOutcome {
  readonly decisionId: number;
  readonly state: PanelState;
  readonly dispatched: DecisionNotifications | null;
}

function leadTimeText(minutesBeforeArrivalWindow: number): string {
  if (minutesBeforeArrivalWindow < 0) {
    return `Recorded ${-minutesBeforeArrivalWindow} min after the arrival window opened`;
  }
  return `Notified ${minutesBeforeArrivalWindow} min before the arrival window`;
}

function AfterSendBy({ late }: { late: boolean }): JSX.Element | null {
  if (!late) {
    return null;
  }
  return <p className="font-medium">{AFTER_SEND_BY_TEXT}</p>;
}

function DispatchedTable({
  view,
  timezone,
}: {
  view: DecisionNotifications;
  timezone: string;
}): JSX.Element {
  const names = new Map(
    view.package.recipients.map((recipient) => [
      recipient.employeeId,
      recipient.name,
    ]),
  );
  return (
    <Table aria-label={DISPATCHED_LABEL}>
      <TableHeader>
        <TableRow>
          <TableHead>{NAME_COLUMN}</TableHead>
          <TableHead>{CHANNEL_COLUMN}</TableHead>
          <TableHead>{RECORDED_COLUMN}</TableHead>
          <TableHead>{LEAD_TIME_COLUMN}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {view.dispatches.map((dispatch) => (
          <TableRow key={dispatch.employeeId}>
            <TableCell>
              {names.get(dispatch.employeeId) ?? UNKNOWN_RECIPIENT}
            </TableCell>
            <TableCell>{CHANNEL_LABELS[dispatch.channel]}</TableCell>
            <TableCell>
              {facilityClock(
                dispatch.recordedAt,
                timezone,
                view.package.facilityDate,
              )}
            </TableCell>
            <TableCell>
              <p>{leadTimeText(dispatch.minutesBeforeArrivalWindow)}</p>
              <AfterSendBy late={dispatch.recordedAfterSendBy} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function StateAlert({ state }: { state: PanelState }): JSX.Element | null {
  switch (state.kind) {
    case "conflict":
      return (
        <Alert role="alert">
          <AlertDescription>{state.conflict.message}</AlertDescription>
        </Alert>
      );
    case "checking":
      return (
        <Alert role="alert">
          <AlertDescription>{CHECKING_TEXT}</AlertDescription>
        </Alert>
      );
    case "unconfirmed":
      return (
        <Alert role="alert">
          <AlertDescription>{UNCONFIRMED_TEXT}</AlertDescription>
        </Alert>
      );
    case "failed":
      return (
        <Alert role="alert" variant="destructive">
          <AlertDescription>{FAILED_TEXT}</AlertDescription>
        </Alert>
      );
    case "ready":
    case "dispatching":
      return null;
    default:
      return state satisfies never;
  }
}

function shownFor(
  local: LocalOutcome | null,
  decisionId: number,
  initial: DecisionNotifications,
): { readonly state: PanelState; readonly view: DecisionNotifications } {
  if (local === null || local.decisionId !== decisionId) {
    return { state: READY, view: initial };
  }
  return { state: local.state, view: local.dispatched ?? initial };
}

export function DispatchPanel({
  decisionId,
  initial,
  timezone,
  dispatch,
  onReload,
}: {
  decisionId: number;
  initial: DecisionNotifications;
  timezone: string;
  /** Carries the shown package's hash, so the API refuses to send one the manager did not see. */
  dispatch: (
    decisionId: number,
    packageHash: string,
  ) => Promise<DispatchResult>;
  /** Called after every answer: a dispatch appends to the record chain, and a 409 means the shown package or decision is stale. */
  onReload: () => Promise<void>;
}): JSX.Element {
  const [local, setLocal] = useState<LocalOutcome | null>(null);
  const { state, view } = shownFor(local, decisionId, initial);

  const onDispatch = useCallback(async (): Promise<void> => {
    function settle(
      next: PanelState,
      dispatched: DecisionNotifications | null = null,
    ): void {
      setLocal({ decisionId, state: next, dispatched });
    }
    settle({ kind: "dispatching" });
    let result: DispatchResult;
    try {
      result = await dispatch(
        decisionId,
        shownFor(local, decisionId, initial).view.packageHash,
      );
    } catch {
      // A lost response may hide a dispatch that committed, so read back what was recorded.
      settle({ kind: "checking" });
      try {
        await onReload();
        settle({ kind: "unconfirmed" });
      } catch {
        settle({ kind: "failed" });
      }
      return;
    }
    if (result.kind === "conflict") {
      settle({ kind: "conflict", conflict: result.conflict });
    } else {
      settle(READY, result.view);
    }
    await onReload();
  }, [dispatch, decisionId, onReload, local, initial]);

  let content = (
    <>
      <NotificationRecipients pkg={view.package} timezone={timezone} />
      {view.package.recipients.length > 0 && (
        <Button disabled={BUSY_KINDS.includes(state.kind)} onClick={onDispatch}>
          {DISPATCH_LABEL}
        </Button>
      )}
    </>
  );
  if (view.dispatches.length > 0) {
    content = (
      <>
        <h3 className="font-medium">{DISPATCHED_LABEL}</h3>
        <DispatchedTable timezone={timezone} view={view} />
      </>
    );
  }
  return (
    <div className="space-y-2">
      <StateAlert state={state} />
      {content}
    </div>
  );
}
