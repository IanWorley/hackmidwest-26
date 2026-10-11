import { useState } from "react";

type ConfirmState<Body> =
  | { readonly kind: "idle" }
  | { readonly kind: "confirming"; readonly body: Body }
  | { readonly kind: "submitting"; readonly body: Body };

interface ConfirmDialogState {
  readonly open: boolean;
  readonly pending: boolean;
  readonly onConfirm: () => Promise<void>;
  readonly onCancel: () => void;
}

interface ConfirmedSubmit<Body> {
  /** Holds the body for confirmation; nothing is submitted until the dialog confirms. */
  readonly request: (body: Body) => void;
  readonly dialogProps: ConfirmDialogState;
}

export function useConfirmedSubmit<Body>(
  submit: (body: Body) => Promise<unknown>,
): ConfirmedSubmit<Body> {
  const [state, setState] = useState<ConfirmState<Body>>({ kind: "idle" });

  async function onConfirm(): Promise<void> {
    if (state.kind !== "confirming") {
      return;
    }
    setState({ kind: "submitting", body: state.body });
    try {
      await submit(state.body);
    } finally {
      setState({ kind: "idle" });
    }
  }

  function onCancel(): void {
    if (state.kind === "confirming") {
      setState({ kind: "idle" });
    }
  }

  return {
    request: (body) => setState({ kind: "confirming", body }),
    dialogProps: {
      open: state.kind !== "idle",
      pending: state.kind === "submitting",
      onConfirm,
      onCancel,
    },
  };
}

export type { ConfirmDialogState };
