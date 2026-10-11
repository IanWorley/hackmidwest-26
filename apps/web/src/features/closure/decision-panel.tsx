import { type FormEvent, type JSX, useId, useReducer } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { NativeSelectOption } from "@/components/ui/native-select";
import type {
  DecideOutcome,
  Decision,
  DecisionMaker,
  DecisionRequest,
  HumanAction,
  Recommendation,
} from "./decision-api";
import {
  controlForApiField,
  DECISION_FIELD_NAMES,
  type FormField,
  readDecisionForm,
  reasonRequired,
} from "./decision-form";
import {
  FieldError,
  ReasonFields,
  RecordedByField,
  SelectField,
} from "./form-fields";
import { ACTION_BUTTON_LABELS, labeledOptions, POSTURE_LABELS } from "./labels";

const MS_PER_MINUTE = 60_000;
const RECHECK_MINUTES = [15, 30, 60, 120] as const;

const PANEL_HEADING = "Decide";
const ACTIONS_LABEL = "Decision actions";
const POSTURE_FIELD_LABEL = "Posture instead";
const RECHECK_FIELD_LABEL = "Re-check in";
const NO_RECHECK_TEXT =
  "No re-check time fits before the decision deadline, so this cannot be deferred.";
const CANCEL_LABEL = "Cancel";
const SUBMITTING_LABEL = "Recording…";
const RECORDED_TEXT = "Decision recorded.";
const FAILED_TITLE = "The decision could not be recorded.";
const FAILED_TEXT = "Nothing was saved. Try again.";
const NEWER_RECOMMENDATION_TITLE = "A newer recommendation exists.";
const NEWER_RECOMMENDATION_TEXT =
  "Nothing was saved. The newer recommendation is now shown above; review it before you decide.";
const DECISION_CHANGED_TITLE = "Someone else decided first.";
const DECISION_CHANGED_TEXT =
  "Nothing was saved. The decision history below is reloaded; review it before you decide again.";

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

const FIELD_ERRORS: Record<FormField, string> = {
  recordedBy: "Choose who is recording this.",
  posture: "Choose a posture other than the recommended one.",
  recheckIn: "Choose a re-check time before the decision deadline.",
  reasonCategory: "Choose a reason category.",
  reasonText: "Enter a reason.",
  scope: "Choose who this applies to.",
  directive: "Choose a directive.",
  form: "The request was refused. Check every field and try again.",
};

type Conflict = Extract<DecideOutcome, { kind: "conflict" }>["conflict"];

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

const INITIAL_STATE: PanelState = { status: "viewing" };

function actionOf(state: PanelState): HumanAction | undefined {
  return "action" in state ? state.action : undefined;
}

export function panelReducer(state: PanelState, event: PanelEvent): PanelState {
  const action = actionOf(state);
  switch (event.type) {
    case "choose":
      return { status: "deciding", action: event.action };
    case "cancel":
      return INITIAL_STATE;
    case "submit":
      return action === undefined ? state : { status: "submitting", action };
    case "reject":
      return action === undefined
        ? state
        : { status: "invalid", action, field: event.field };
    case "settle":
      if (action === undefined) {
        return state;
      }
      switch (event.outcome.kind) {
        case "recorded":
          return { status: "recorded" };
        case "conflict":
          return { status: "stale", conflict: event.outcome.conflict };
        case "invalid":
          return {
            status: "invalid",
            action,
            field: controlForApiField(event.outcome.field),
          };
        case "failed":
          return { status: "failed", action };
        default:
          return event.outcome satisfies never;
      }
    default:
      return event satisfies never;
  }
}

function StatusNotice({ state }: { state: PanelState }): JSX.Element | null {
  switch (state.status) {
    case "recorded":
      return <p role="status">{RECORDED_TEXT}</p>;
    case "stale":
      return (
        <Alert role="alert">
          <AlertTitle>
            {state.conflict === "newer_recommendation"
              ? NEWER_RECOMMENDATION_TITLE
              : DECISION_CHANGED_TITLE}
          </AlertTitle>
          <AlertDescription>
            {state.conflict === "newer_recommendation"
              ? NEWER_RECOMMENDATION_TEXT
              : DECISION_CHANGED_TEXT}
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

function ActionFields({
  action,
  formId,
  recommendation,
  now,
  errorFor,
}: {
  action: HumanAction;
  formId: string;
  recommendation: Recommendation;
  now: number;
  errorFor: (field: FormField) => string | undefined;
}): JSX.Element | null {
  switch (action) {
    case "accept":
      return null;
    case "override":
      return (
        <SelectField
          error={errorFor("posture")}
          formId={formId}
          label={POSTURE_FIELD_LABEL}
          name={DECISION_FIELD_NAMES.posture}
        >
          {labeledOptions(POSTURE_LABELS)
            .filter(({ value }) => value !== recommendation.posture)
            .map(({ value, label }) => (
              <NativeSelectOption key={value} value={value}>
                {label}
              </NativeSelectOption>
            ))}
        </SelectField>
      );
    case "defer": {
      const remainingMinutes =
        (Date.parse(recommendation.decideBy) - now) / MS_PER_MINUTE;
      const fitting = RECHECK_MINUTES.filter(
        (minutes) => minutes < remainingMinutes,
      );
      if (fitting.length === 0) {
        return <p>{NO_RECHECK_TEXT}</p>;
      }
      return (
        <SelectField
          error={errorFor("recheckIn")}
          formId={formId}
          label={RECHECK_FIELD_LABEL}
          name={DECISION_FIELD_NAMES.recheckIn}
        >
          {fitting.map((minutes) => (
            <NativeSelectOption key={minutes} value={minutes}>
              {`${minutes} min`}
            </NativeSelectOption>
          ))}
        </SelectField>
      );
    }
    default:
      return action satisfies never;
  }
}

export function DecisionPanel({
  recommendation,
  currentDecision,
  decisionMakers,
  now,
  onDecide,
  onReload,
}: {
  recommendation: Recommendation;
  /** The newest decision on this recommendation, which a new one must supersede. */
  currentDecision: Decision | null;
  decisionMakers: readonly DecisionMaker[];
  now: number;
  onDecide: (request: DecisionRequest) => Promise<DecideOutcome>;
  onReload: () => Promise<void>;
}): JSX.Element {
  const [state, dispatch] = useReducer(panelReducer, INITIAL_STATE);
  const formId = useId();
  const action = actionOf(state);
  const supersedesDecisionId = currentDecision?.id;
  const invalidField = state.status === "invalid" ? state.field : undefined;
  const errorFor = (field: FormField): string | undefined =>
    invalidField === field ? FIELD_ERRORS[field] : undefined;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (action === undefined) {
      return;
    }
    const read = readDecisionForm(action, new FormData(event.currentTarget), {
      supersedesDecisionId,
      submittedAt: Date.now(),
    });
    if (read.kind === "invalid") {
      dispatch({ type: "reject", field: read.field });
      return;
    }
    dispatch({ type: "submit" });
    const outcome = await onDecide(read.request);
    dispatch({ type: "settle", outcome });
    if (outcome.kind === "recorded" || outcome.kind === "conflict") {
      await onReload();
    }
  }

  return (
    <section aria-labelledby={`${formId}-heading`} className="space-y-4">
      <h2
        className="font-heading font-semibold text-xl"
        id={`${formId}-heading`}
      >
        {PANEL_HEADING}
      </h2>
      <StatusNotice state={state} />
      <div aria-label={ACTIONS_LABEL} className="flex gap-2" role="group">
        {labeledOptions(ACTION_BUTTON_LABELS).map(({ value, label }) => (
          <Button
            aria-pressed={action === value}
            disabled={state.status === "submitting"}
            key={value}
            onClick={() => dispatch({ type: "choose", action: value })}
            type="button"
            variant={action === value ? "default" : "outline"}
          >
            {label}
          </Button>
        ))}
      </div>
      {action !== undefined && (
        <form
          aria-labelledby={`${formId}-form-heading`}
          className="max-w-xl space-y-4 rounded-lg border p-4"
          key={action}
          noValidate={true}
          onSubmit={submit}
        >
          <h3 className="font-medium" id={`${formId}-form-heading`}>
            {FORM_HEADINGS[action]}
          </h3>
          <ActionFields
            action={action}
            errorFor={errorFor}
            formId={formId}
            now={now}
            recommendation={recommendation}
          />
          <ReasonFields
            categoryError={errorFor("reasonCategory")}
            formId={formId}
            required={reasonRequired(action, supersedesDecisionId)}
            textError={errorFor("reasonText")}
          />
          <RecordedByField
            decisionMakers={decisionMakers}
            error={errorFor("recordedBy")}
            formId={formId}
          />
          <FieldError field="form" formId={formId} message={errorFor("form")} />
          <div className="flex gap-2">
            <Button disabled={state.status === "submitting"} type="submit">
              {state.status === "submitting"
                ? SUBMITTING_LABEL
                : SUBMIT_LABELS[action]}
            </Button>
            <Button
              disabled={state.status === "submitting"}
              onClick={() => dispatch({ type: "cancel" })}
              type="button"
              variant="ghost"
            >
              {CANCEL_LABEL}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
