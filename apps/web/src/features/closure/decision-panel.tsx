import {
  type ActionDispatch,
  type JSX,
  type SubmitEvent,
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { PostureField, RecheckField } from "./decision-action-fields";
import type {
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
import { StatusNotice } from "./decision-panel-notice";
import {
  INITIAL_PANEL_STATE,
  openAction,
  type PanelEvent,
  type PanelState,
  panelReducer,
} from "./decision-panel-state";
import { FieldError, ReasonFields, RecordedByField } from "./form-fields";
import { ACTION_BUTTON_LABELS, labeledOptions } from "./labels";
import { fittingRecheckMinutes, NO_RECHECK_TEXT } from "./recheck-times";

const PANEL_HEADING = "Decide";
const ACTIONS_LABEL = "Decision actions";
const CANCEL_LABEL = "Cancel";
const SUBMITTING_LABEL = "Recording…";
const DIRECTIVES_NOTE =
  "Directives belong to the decision they were issued on. A new decision starts with none.";

/** Outcomes with nothing to fix in a field, so focus moves to the notice that explains them. */
const NOTICE_STATUSES: readonly PanelState["status"][] = [
  "recorded",
  "stale",
  "failed",
];

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
  /** The recommendation the panel decides on; a new one closes any open draft. */
  readonly recommendationId: number;
  /** The newest decision on this recommendation, which a new one must supersede. */
  readonly supersedesDecisionId: number | undefined;
  /** A decision stands for the facility day, so a new one replaces it and its directives. */
  readonly hasCurrentDecision: boolean;
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

function ActionButton({
  action,
  label,
  state,
  dispatch,
  unavailable,
}: FormStateProps & {
  readonly action: HumanAction;
  readonly label: string;
  readonly unavailable: boolean;
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
      disabled={unavailable || state.status === "submitting"}
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
  unavailable,
}: FormStateProps & {
  readonly action: HumanAction;
  readonly unavailable: boolean;
}): JSX.Element {
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
      <Button disabled={unavailable || submitting} type="submit">
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

/** Every action is open until the deadline leaves no re-check time, which closes Defer. */
function canTake(action: HumanAction, panel: DecisionPanelProps): boolean {
  return (
    action !== "defer" ||
    fittingRecheckMinutes(panel.decideBy, panel.now).length > 0
  );
}

function ActionButtons({
  state,
  dispatch,
  panel,
}: FormStateProps & { readonly panel: DecisionPanelProps }): JSX.Element {
  return (
    <>
      <fieldset className="flex gap-2">
        <legend className="sr-only">{ACTIONS_LABEL}</legend>
        {labeledOptions(ACTION_BUTTON_LABELS).map(({ value, label }) => (
          <ActionButton
            action={value}
            dispatch={dispatch}
            key={value}
            label={label}
            state={state}
            unavailable={!canTake(value, panel)}
          />
        ))}
      </fieldset>
      {!canTake("defer", panel) && (
        <p className="text-muted-foreground">{NO_RECHECK_TEXT}</p>
      )}
    </>
  );
}

/** Reads the form, records the decision, and settles only after any reload it needs. */
function useDecisionSubmit(
  action: HumanAction,
  dispatch: ActionDispatch<[PanelEvent]>,
  panel: DecisionPanelProps,
): (event: SubmitEvent<HTMLFormElement>) => Promise<void> {
  return useCallback(
    async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      const read = readDecisionForm(action, new FormData(event.currentTarget), {
        supersedesDecisionId: panel.supersedesDecisionId,
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

  const submit = useDecisionSubmit(action, dispatch, panel);

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
        required={reasonRequired(action, panel.supersedesDecisionId)}
        {...fieldProps}
      />
      <RecordedByField recorders={panel.recorders} {...fieldProps} />
      <FieldError field="form" {...fieldProps} />
      <SubmitButtons
        action={action}
        dispatch={dispatch}
        state={state}
        unavailable={!canTake(action, panel)}
      />
    </form>
  );
}

export function DecisionPanel(props: DecisionPanelProps): JSX.Element {
  const [state, dispatch] = useReducer(panelReducer, INITIAL_PANEL_STATE);
  // Adjusting state during render, as React documents, so the old draft never paints against the new recommendation.
  const [shownRecommendationId, setShownRecommendationId] = useState(
    props.recommendationId,
  );
  if (shownRecommendationId !== props.recommendationId) {
    setShownRecommendationId(props.recommendationId);
    dispatch({ type: "recommendationChanged" });
  }
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
      {props.hasCurrentDecision === true && (
        <p className="text-muted-foreground">{DIRECTIVES_NOTE}</p>
      )}
      <StatusNotice ref={noticeRef} state={state} />
      <ActionButtons dispatch={dispatch} panel={props} state={state} />
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
