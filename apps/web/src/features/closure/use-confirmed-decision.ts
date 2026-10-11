import { useState } from "react";
import type { DecideOutcome, DecisionRequest } from "./decision-api";

type Submit = (request: DecisionRequest) => Promise<DecideOutcome>;

/** The panel awaits its submit, so a held request keeps the resolver that answers that await. */
type ConfirmState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "confirming" | "submitting";
      readonly request: DecisionRequest;
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

function heldRequest(state: ConfirmState): DecisionRequest | null {
  if (state.kind === "idle") {
    return null;
  }
  return state.request;
}

export function useConfirmedDecision(submit: Submit): ConfirmedDecision {
  const [state, setState] = useState<ConfirmState>({ kind: "idle" });

  function submitDecision(request: DecisionRequest): Promise<DecideOutcome> {
    return new Promise((settle) => {
      setState({ kind: "confirming", request, settle });
    });
  }

  async function onConfirm(): Promise<void> {
    if (state.kind !== "confirming") {
      return;
    }
    setState({ ...state, kind: "submitting" });
    const outcome = await submit(state.request).catch(() => FAILED);
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
