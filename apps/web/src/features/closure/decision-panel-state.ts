import type { Conflict, DecideOutcome, HumanAction } from "./decision-api";
import type { FormField } from "./decision-form";

/** One state at a time, so the panel cannot be both submitting and showing a stale warning. */
type PanelState =
  | { readonly status: "viewing" }
  | { readonly status: "deciding"; readonly action: HumanAction }
  | { readonly status: "submitting"; readonly action: HumanAction }
  | {
      readonly status: "invalid";
      readonly action: HumanAction;
      readonly field: FormField;
    }
  | { readonly status: "failed"; readonly action: HumanAction }
  | { readonly status: "recorded" }
  | { readonly status: "stale"; readonly conflict: Conflict };

type PanelEvent =
  | { readonly type: "choose"; readonly action: HumanAction }
  | { readonly type: "cancel" }
  | { readonly type: "submit" }
  | { readonly type: "reject"; readonly field: FormField }
  | { readonly type: "settle"; readonly outcome: DecideOutcome };

const INITIAL_PANEL_STATE: PanelState = { status: "viewing" };

function openAction(state: PanelState): HumanAction | undefined {
  if ("action" in state) {
    return state.action;
  }
  return undefined;
}

function settle(action: HumanAction, outcome: DecideOutcome): PanelState {
  switch (outcome.kind) {
    case "recorded":
      return { status: "recorded" };
    case "conflict":
      return { status: "stale", conflict: outcome.conflict };
    case "invalid":
      return { status: "invalid", action, field: outcome.field };
    case "failed":
      return { status: "failed", action };
    case "cancelled":
      return { status: "deciding", action };
    default:
      return outcome satisfies never;
  }
}

/** A submit in flight keeps its form until it settles, and events that need an open form leave a closed panel as it is. */
function panelReducer(state: PanelState, event: PanelEvent): PanelState {
  if (state.status === "submitting" && event.type !== "settle") {
    return state;
  }
  if (event.type === "choose") {
    return { status: "deciding", action: event.action };
  }
  if (event.type === "cancel") {
    return INITIAL_PANEL_STATE;
  }
  const action = openAction(state);
  if (action === undefined) {
    return state;
  }
  switch (event.type) {
    case "submit":
      return { status: "submitting", action };
    case "reject":
      return { status: "invalid", action, field: event.field };
    case "settle":
      return settle(action, event.outcome);
    default:
      return event satisfies never;
  }
}

export type { PanelEvent, PanelState };
export { INITIAL_PANEL_STATE, openAction, panelReducer };
