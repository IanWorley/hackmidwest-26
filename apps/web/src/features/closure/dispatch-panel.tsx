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
  | { readonly kind: "failed" };

const DISPATCH_LABEL = "Dispatch notifications";
const DISPATCHED_LABEL = "Dispatched notices";
const FAILED_TEXT = "Dispatch failed. Try again.";
const NAME_COLUMN = "Name";
const CHANNEL_COLUMN = "Channel";
const RECORDED_COLUMN = "Recorded at";
const LEAD_TIME_COLUMN = "Lead time";
const AFTER_SEND_BY_TEXT = "After send-by";
const UNKNOWN_RECIPIENT = "Unknown recipient";

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

export function DispatchPanel({
  decisionId,
  initial,
  timezone,
  dispatch,
}: {
  decisionId: number;
  initial: DecisionNotifications;
  timezone: string;
  dispatch: (decisionId: number) => Promise<DispatchResult>;
}): JSX.Element {
  const [view, setView] = useState(initial);
  const [state, setState] = useState<PanelState>({ kind: "ready" });

  const onDispatch = useCallback(async (): Promise<void> => {
    setState({ kind: "dispatching" });
    try {
      const result = await dispatch(decisionId);
      if (result.kind === "conflict") {
        setState({ kind: "conflict", conflict: result.conflict });
        return;
      }
      setView(result.view);
      setState({ kind: "ready" });
    } catch {
      setState({ kind: "failed" });
    }
  }, [dispatch, decisionId]);

  let content = (
    <>
      <NotificationRecipients pkg={view.package} timezone={timezone} />
      <Button disabled={state.kind === "dispatching"} onClick={onDispatch}>
        {DISPATCH_LABEL}
      </Button>
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
