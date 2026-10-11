import type { JSX } from "react";
import { Badge } from "@/components/ui/badge";
import type { DecisionVerification } from "./notification-api";
import {
  CHAIN_BREAK_REASON_LABELS,
  CHAIN_RECORD_LABELS,
} from "./notification-labels";

const INTACT_LABEL = "Chain intact";
const BROKEN_LABEL = "Chain broken";
const BREAKS_LABEL = "Chain breaks";

export function ChainStatus({
  verification,
}: {
  verification: DecisionVerification;
}): JSX.Element {
  if (verification.intact) {
    return <Badge variant="secondary">{INTACT_LABEL}</Badge>;
  }
  return (
    <ul aria-label={BREAKS_LABEL}>
      {verification.breaks.map((broken) => (
        <li key={`${broken.record}:${broken.id}`}>
          <Badge variant="destructive">{BROKEN_LABEL}</Badge>
          {`: ${CHAIN_RECORD_LABELS[broken.record]} ${broken.id} (${CHAIN_BREAK_REASON_LABELS[broken.reason]})`}
        </li>
      ))}
    </ul>
  );
}
