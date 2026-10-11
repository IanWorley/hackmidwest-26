import type { JSX } from "react";
import { ChainStatus } from "./decision-verification";
import { DispatchPanel } from "./dispatch-panel";
import {
  type DecisionNotificationsResult,
  type DecisionVerification,
  dispatchDecision,
  refreshDecisionNotifications,
} from "./notification-api";

const NOTIFICATIONS_HEADING = "Notifications";
const CHAIN_HEADING = "Record chain";

export function NotificationsSection({
  decisionId,
  onReload,
  result,
  timezone,
}: {
  decisionId: number;
  onReload: () => Promise<void>;
  result: DecisionNotificationsResult;
  timezone: string;
}): JSX.Element {
  return (
    <section aria-label={NOTIFICATIONS_HEADING} className="space-y-4">
      <h2 className="font-heading font-semibold text-xl">
        {NOTIFICATIONS_HEADING}
      </h2>
      {result.kind === "conflict" && (
        <p role="status">{result.conflict.message}</p>
      )}
      {result.kind === "found" && (
        <DispatchPanel
          decisionId={decisionId}
          dispatch={dispatchDecision}
          initial={result.view}
          onReload={onReload}
          refresh={refreshDecisionNotifications}
          timezone={timezone}
        />
      )}
    </section>
  );
}

export function ChainSection({
  verification,
}: {
  verification: DecisionVerification;
}): JSX.Element {
  return (
    <section aria-label={CHAIN_HEADING} className="space-y-2">
      <h2 className="font-heading font-semibold text-xl">{CHAIN_HEADING}</h2>
      <ChainStatus verification={verification} />
    </section>
  );
}
