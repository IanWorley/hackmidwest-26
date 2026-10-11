import type { JSX, RefObject } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { Conflict } from "./decision-api";
import type { PanelState } from "./decision-panel-state";

const RECORDED_TEXT = "Decision recorded.";
const FAILED_TITLE = "The decision could not be recorded.";
const FAILED_TEXT = "Nothing was saved. Try again.";

const CONFLICT_NOTICES: Record<
  Conflict,
  { readonly title: string; readonly text: string }
> = {
  previewRecommendation: {
    title: "That recommendation was a preview, not the live one.",
    text: "Nothing was saved. The page is reloaded with the live recommendation, if there is one; review it before you decide.",
  },
  newerRecommendation: {
    title: "A newer recommendation exists.",
    text: "Nothing was saved. The newer recommendation is now shown above; review it before you decide.",
  },
  decisionChanged: {
    title: "Someone else decided first.",
    text: "Nothing was saved. The decision history below is reloaded; review it before you decide again.",
  },
};

function OutcomeAlert({ state }: { state: PanelState }): JSX.Element | null {
  switch (state.status) {
    case "stale":
      return (
        <Alert role="alert">
          <AlertTitle>{CONFLICT_NOTICES[state.conflict].title}</AlertTitle>
          <AlertDescription>
            {CONFLICT_NOTICES[state.conflict].text}
          </AlertDescription>
        </Alert>
      );
    case "failed":
      return (
        <Alert role="alert" variant="destructive">
          <AlertTitle>{FAILED_TITLE}</AlertTitle>
          <AlertDescription>{FAILED_TEXT}</AlertDescription>
        </Alert>
      );
    default:
      return null;
  }
}

/** The status line stays mounted and only its text changes, so screen readers announce it reliably. */
export function StatusNotice({
  state,
  ref,
}: {
  readonly state: PanelState;
  readonly ref: RefObject<HTMLDivElement | null>;
}): JSX.Element {
  let statusText = "";
  if (state.status === "recorded") {
    statusText = RECORDED_TEXT;
  }
  return (
    <div className="space-y-4" ref={ref} tabIndex={-1}>
      <p role="status">{statusText}</p>
      <OutcomeAlert state={state} />
    </div>
  );
}
