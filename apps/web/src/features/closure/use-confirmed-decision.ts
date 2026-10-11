import { useEffect, useState } from "react";
import type {
  DecideOutcome,
  DecisionRequest,
  Recommendation,
} from "./decision-api";

type Submit = (request: DecisionRequest) => Promise<DecideOutcome>;
/** The recommendation `submit` records against. */
type Target = Pick<Recommendation, "id" | "decideBy">;

/** The panel awaits its submit, so a held request keeps the resolver that answers that await. */
type ConfirmState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "confirming" | "submitting";
      readonly request: DecisionRequest;
      /** When the panel built the request, so a deferral keeps its full interval past the review. */
      readonly heldAt: number;
      /** The recommendation the manager reviewed the request against. */
      readonly heldFor: number;
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

const IDLE: ConfirmState = { kind: "idle" };
const CANCELLED: DecideOutcome = { kind: "cancelled" };
const FAILED: DecideOutcome = { kind: "failed" };
/** The API refuses a re-check at or past the deadline, so the form asks for an earlier one. */
const RECHECK_TOO_LATE: DecideOutcome = { kind: "invalid", field: "recheckIn" };

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

/** Whether a deferral's shifted re-check still falls before the decision deadline. */
function fitsDeadline(request: DecisionRequest, decideBy: string): boolean {
  return (
    request.action !== "defer" ||
    Date.parse(request.recheckAt) < Date.parse(decideBy)
  );
}

/**
 * A reload onto another recommendation drops a request still awaiting confirmation, because the
 * manager reviewed it for the old one.
 */
export function useConfirmedDecision(
  submit: Submit,
  { id: recommendationId, decideBy }: Target,
): ConfirmedDecision {
  const [state, setState] = useState<ConfirmState>({ kind: "idle" });
  // A request still awaiting confirmation for an older recommendation is hidden at once and
  // answered as cancelled, so the panel, which waits in `submitting` for that answer, returns to
  // the new recommendation. Its state is left for the next submit to replace.
  const stale =
    state.kind === "confirming" && state.heldFor !== recommendationId;
  useEffect(() => {
    if (stale && state.kind === "confirming") {
      state.settle(CANCELLED);
    }
  }, [stale, state]);
  let shown = state;
  if (stale) {
    shown = IDLE;
  }

  function submitDecision(request: DecisionRequest): Promise<DecideOutcome> {
    return new Promise((settle) => {
      setState({
        kind: "confirming",
        request,
        heldAt: Date.now(),
        heldFor: recommendationId,
        settle,
      });
    });
  }

  async function onConfirm(): Promise<void> {
    if (state.kind !== "confirming" || stale) {
      return;
    }
    const request = confirmedRequest(state.request, state.heldAt, Date.now());
    // A long review can push the shifted re-check past the deadline; nothing is sent then.
    if (!fitsDeadline(request, decideBy)) {
      setState({ kind: "idle" });
      state.settle(RECHECK_TOO_LATE);
      return;
    }
    setState({ ...state, kind: "submitting" });
    const outcome = await submit(request).catch(() => FAILED);
    setState({ kind: "idle" });
    state.settle(outcome);
  }

  function onCancel(): void {
    if (state.kind !== "confirming" || stale) {
      return;
    }
    setState({ kind: "idle" });
    state.settle(CANCELLED);
  }

  return {
    submitDecision,
    dialogProps: {
      open: shown.kind !== "idle",
      pending: shown.kind === "submitting",
      request: heldRequest(shown),
      onConfirm,
      onCancel,
    },
  };
}

export type { ConfirmDialogState };
