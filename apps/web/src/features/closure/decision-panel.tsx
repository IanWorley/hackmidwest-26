import {
  type ActionDispatch,
  type JSX,
  type RefObject,
  type SubmitEvent,
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
} from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PostureField, RecheckField } from "./decision-action-fields";
import type {
  Conflict,
  DecideOutcome,
  DecisionRequest,
  HumanAction,
  Posture,
  Recorder,
} from "./decision-api";
import {
  type FormField,
  focusFieldError,
  readDecisionForm,
  reasonRequired,
} from "./decision-form";
import {
  INITIAL_PANEL_STATE,
  openAction,
  type PanelEvent,
  type PanelState,
  panelReducer,
} from "./decision-panel-state";
import { FieldError, ReasonFields, RecordedByField } from "./form-fields";
import { ACTION_BUTTON_LABELS, labeledOptions } from "./labels";

const PANEL_HEADING = "Decide";
const ACTIONS_LABEL = "Decision actions";
const CANCEL_LABEL = "Cancel";
const SUBMITTING_LABEL = "Recording…";
const RECORDED_TEXT = "Decision recorded.";
const FAILED_TITLE = "The decision could not be recorded.";
const FAILED_TEXT = "Nothing was saved. Try again.";
const DIRECTIVES_NOTE =
  "Directives belong to the decision they were issued on. A new decision starts with none.";

/** Outcomes with nothing to fix in a field, so focus moves to the notice that explains them. */
const NOTICE_STATUSES: readonly PanelState["status"][] = [
  "recorded",
  "stale",
  "failed",
];

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

const FORM_HEADINGS: Record<HumanAction, string> = {
  accept: "Accept the recommendation",
  override: "Override the recommendation",
  defer: "Defer the decision",
};

const SUBMIT_LABELS: Record<HumanAction, string> = {
  accept: "Record acceptance",
  override: "Record override",
  defer: "Record deferral",
};

interface DecisionPanelProps {
  readonly recommendedPosture: Posture;
  readonly decideBy: string;
  /** The newest decision on this recommendation, which a new one must supersede. */
  readonly currentDecisionId: number | undefined;
  readonly recorders: readonly Recorder[];
  readonly now: number;
  /** Records the decision on the shown recommendation; a caller may wrap it, for example with a confirmation step. */
  readonly submitDecision: (request: DecisionRequest) => Promise<DecideOutcome>;
  readonly onReload: () => Promise<void>;
}

interface FormStateProps {
  readonly state: PanelState;
  readonly dispatch: ActionDispatch<[PanelEvent]>;
}

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
function StatusNotice({
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

function ActionButton({
  action,
  label,
  state,
  dispatch,
}: FormStateProps & {
  readonly action: HumanAction;
  readonly label: string;
}): JSX.Element {
  const pressed = openAction(state) === action;
  let variant: "default" | "outline" = "outline";
  if (pressed) {
    variant = "default";
  }
  const choose = useCallback((): void => {
    dispatch({ type: "choose", action });
  }, [dispatch, action]);
  return (
    <Button
      aria-pressed={pressed}
      disabled={state.status === "submitting"}
      onClick={choose}
      type="button"
      variant={variant}
    >
      {label}
    </Button>
  );
}

function SubmitButtons({
  action,
  state,
  dispatch,
}: FormStateProps & { readonly action: HumanAction }): JSX.Element {
  const submitting = state.status === "submitting";
  let submitLabel = SUBMIT_LABELS[action];
  if (submitting) {
    submitLabel = SUBMITTING_LABEL;
  }
  const cancel = useCallback((): void => {
    dispatch({ type: "cancel" });
  }, [dispatch]);
  return (
    <div className="flex gap-2">
      <Button disabled={submitting} type="submit">
        {submitLabel}
      </Button>
      <Button
        disabled={submitting}
        onClick={cancel}
        type="button"
        variant="ghost"
      >
        {CANCEL_LABEL}
      </Button>
    </div>
  );
}

function DecisionForm({
  action,
  state,
  dispatch,
  panel,
}: FormStateProps & {
  readonly action: HumanAction;
  readonly panel: DecisionPanelProps;
}): JSX.Element {
  const formId = useId();
  let invalidField: FormField | undefined;
  if (state.status === "invalid") {
    invalidField = state.field;
  }
  const fieldProps = { formId, invalidField };

  useEffect(() => {
    if (state.status === "invalid") {
      focusFieldError(formId, state.field);
    }
  }, [formId, state]);

  const submit = useCallback(
    async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      const read = readDecisionForm(action, new FormData(event.currentTarget), {
        supersedesDecisionId: panel.currentDecisionId,
        submittedAt: Date.now(),
      });
      if (read.kind === "invalid") {
        dispatch({ type: "reject", field: read.field });
        return;
      }
      dispatch({ type: "submit" });
      const outcome = await panel.submitDecision(read.request);
      // Settle after the reload, so a notice that says the page now shows something is already true.
      if (outcome.kind === "recorded" || outcome.kind === "conflict") {
        await panel.onReload();
      }
      dispatch({ type: "settle", outcome });
    },
    [action, dispatch, panel],
  );

  return (
    <form
      aria-labelledby={`${formId}-heading`}
      className="max-w-xl space-y-4 rounded-lg border p-4"
      noValidate={true}
      onSubmit={submit}
    >
      <h3 className="font-medium" id={`${formId}-heading`}>
        {FORM_HEADINGS[action]}
      </h3>
      {action === "override" && (
        <PostureField
          recommendedPosture={panel.recommendedPosture}
          {...fieldProps}
        />
      )}
      {action === "defer" && (
        <RecheckField
          decideBy={panel.decideBy}
          now={panel.now}
          {...fieldProps}
        />
      )}
      <ReasonFields
        required={reasonRequired(action, panel.currentDecisionId)}
        {...fieldProps}
      />
      <RecordedByField recorders={panel.recorders} {...fieldProps} />
      <FieldError field="form" {...fieldProps} />
      <SubmitButtons action={action} dispatch={dispatch} state={state} />
    </form>
  );
}

export function DecisionPanel(props: DecisionPanelProps): JSX.Element {
  const [state, dispatch] = useReducer(panelReducer, INITIAL_PANEL_STATE);
  const headingId = useId();
  const noticeRef = useRef<HTMLDivElement>(null);
  const action = openAction(state);

  useEffect(() => {
    if (NOTICE_STATUSES.includes(state.status)) {
      noticeRef.current?.focus();
    }
  }, [state]);

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <h2 className="font-heading font-semibold text-xl" id={headingId}>
        {PANEL_HEADING}
      </h2>
      {props.currentDecisionId !== undefined && (
        <p className="text-muted-foreground">{DIRECTIVES_NOTE}</p>
      )}
      <StatusNotice ref={noticeRef} state={state} />
      <fieldset className="flex gap-2">
        <legend className="sr-only">{ACTIONS_LABEL}</legend>
        {labeledOptions(ACTION_BUTTON_LABELS).map(({ value, label }) => (
          <ActionButton
            action={value}
            dispatch={dispatch}
            key={value}
            label={label}
            state={state}
          />
        ))}
      </fieldset>
      {action !== undefined && (
        <DecisionForm
          action={action}
          dispatch={dispatch}
          key={action}
          panel={props}
          state={state}
        />
      )}
    </section>
  );
}
