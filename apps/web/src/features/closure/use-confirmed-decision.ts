import { useState } from "react";
import type { DecideOutcome, DecisionRequest } from "./decision-api";

type Submit = (request: DecisionRequest) => Promise<DecideOutcome>;

/** The panel awaits its submit, so a held request keeps the resolver that answers that await. */
type ConfirmState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "confirming" | "submitting";
      readonly request: DecisionRequest;
      /** When the panel built the request, so a deferral keeps its full interval past the review. */
      readonly heldAt: number;
      readonly settle: (outcome: DecideOutcome) => void;
    };

interface ConfirmDialogState {
  readonly open: boolean;
  readonly pending: boolean;
  readonly request: DecisionRequest | null;
  readonly onConfirm: () => Promise<void>;
  readonly onCancel: () => void;
}

interface ConfirmedDecision {
  /** Same contract as the panel's submit: it settles once the manager confirms or goes back. */
  readonly submitDecision: Submit;
  readonly dialogProps: ConfirmDialogState;
}

const CANCELLED: DecideOutcome = { kind: "cancelled" };
const FAILED: DecideOutcome = { kind: "failed" };

/** A deferral's recheck time counts from confirmation, not from when the dialog opened. */
function confirmedRequest(
  request: DecisionRequest,
  heldAt: number,
  confirmedAt: number,
): DecisionRequest {
  if (request.action !== "defer") {
    return request;
  }
  const recheckAt = Date.parse(request.recheckAt) + (confirmedAt - heldAt);
  return { ...request, recheckAt: new Date(recheckAt).toISOString() };
}

function heldRequest(state: ConfirmState): DecisionRequest | null {
  if (state.kind === "idle") {
    return null;
  }
  return state.request;
}

/**
 * `recommendationId` is the recommendation `submit` records against. A reload onto another one
 * drops a request still awaiting confirmation, because the manager reviewed it for the old one.
 */
export function useConfirmedDecision(
  submit: Submit,
  recommendationId: number,
): ConfirmedDecision {
  const [state, setState] = useState<ConfirmState>({ kind: "idle" });
  // Adjusting state during render, as the decision panel does, so the dialog never paints against
  // the new recommendation. The held promise is left unsettled: the panel resets itself on the
  // same change, so nothing is waiting on its answer.
  const [heldFor, setHeldFor] = useState(recommendationId);
  if (heldFor !== recommendationId) {
    setHeldFor(recommendationId);
    if (state.kind === "confirming") {
      setState({ kind: "idle" });
    }
  }

  function submitDecision(request: DecisionRequest): Promise<DecideOutcome> {
    return new Promise((settle) => {
      setState({ kind: "confirming", request, heldAt: Date.now(), settle });
    });
  }

  async function onConfirm(): Promise<void> {
    if (state.kind !== "confirming") {
      return;
    }
    setState({ ...state, kind: "submitting" });
    const outcome = await submit(
      confirmedRequest(state.request, state.heldAt, Date.now()),
    ).catch(() => FAILED);
    setState({ kind: "idle" });
    state.settle(outcome);
  }

  function onCancel(): void {
    if (state.kind !== "confirming") {
      return;
    }
    setState({ kind: "idle" });
    state.settle(CANCELLED);
  }

  return {
    submitDecision,
    dialogProps: {
      open: state.kind !== "idle",
      pending: state.kind === "submitting",
      request: heldRequest(state),
      onConfirm,
      onCancel,
    },
  };
}

export type { ConfirmDialogState };
