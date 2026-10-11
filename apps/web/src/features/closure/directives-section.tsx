import {
  type JSX,
  type RefObject,
  type SubmitEvent,
  useCallback,
  useEffect,
  useId,
  useReducer,
  useRef,
} from "react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import type {
  Building,
  Decision,
  Directive,
  DirectiveOutcome,
  DirectiveRequest,
  Posture,
  Recorder,
} from "./decision-api";
import { FIELD_NAMES, type FormField, focusFieldError } from "./decision-form";
import {
  readDirectiveForm,
  type ScopeOption,
  type SectionState,
  scopeOptions,
  sectionReducer,
} from "./directive-form";
import { DirectiveList } from "./directive-list";
import {
  FieldError,
  ReasonFields,
  RecordedByField,
  SelectField,
} from "./form-fields";
import { formatFacilityTime } from "./format-time";
import {
  ACTION_LABELS,
  DIRECTIVE_KIND_LABELS,
  labeledOptions,
  POSTURE_LABELS,
} from "./labels";

const SECTION_HEADING = "Directives";
const SECTION_INTRO =
  "Tell a building, the essential group, or one employee to do something other than the posture says. The most specific directive wins, and between two for the same people, the later one wins.";
const STANDING_PREFIX = "Standing decision:";
const RECORDED = "recorded";
const NEWER_RECOMMENDATION_TEXT =
  "The recommendation above is newer and nobody has decided on it, so this decision still stands.";
const SCOPE_LABEL = "Applies to";
const KIND_LABEL = "Directive";
const SUBMIT_LABEL = "Issue directive";
const SUBMITTING_LABEL = "Issuing…";
const ISSUED_TEXT = "Directive issued.";
const SUPERSEDED_TITLE =
  "This decision was changed by someone else. Nothing was saved; the page is reloaded with the current decision.";
const FAILED_TITLE = "The directive could not be issued. Try again.";
const GROUPS_LABEL = "Groups";
const BUILDINGS_LABEL = "Buildings";
const EMPLOYEES_IN = "Employees in";

/** Outcomes with nothing to fix in a field, so focus moves to the notice that explains them. */
const NOTICE_STATUSES: readonly SectionState["status"][] = [
  "issued",
  "superseded",
  "failed",
];

interface FieldProps {
  readonly formId: string;
  readonly invalidField: FormField | undefined;
}

function OutcomeAlert({ state }: { state: SectionState }): JSX.Element | null {
  switch (state.status) {
    case "superseded":
      return (
        <Alert role="alert">
          <AlertTitle>{SUPERSEDED_TITLE}</AlertTitle>
        </Alert>
      );
    case "failed":
      return (
        <Alert role="alert" variant="destructive">
          <AlertTitle>{FAILED_TITLE}</AlertTitle>
        </Alert>
      );
    default:
      return null;
  }
}

/** The status line stays mounted and only its text changes, so screen readers announce it reliably. */
function SectionNotice({
  state,
  ref,
}: {
  readonly state: SectionState;
  readonly ref: RefObject<HTMLDivElement | null>;
}): JSX.Element {
  let statusText = "";
  if (state.status === "issued") {
    statusText = ISSUED_TEXT;
  }
  return (
    <div className="space-y-4" ref={ref} tabIndex={-1}>
      <p role="status">{statusText}</p>
      <OutcomeAlert state={state} />
    </div>
  );
}

function ScopeOptionList({
  options,
}: {
  options: readonly ScopeOption[];
}): JSX.Element {
  return (
    <>
      {options.map(({ key, label }) => (
        <NativeSelectOption key={key} value={key}>
          {label}
        </NativeSelectOption>
      ))}
    </>
  );
}

function ScopeField({
  buildings,
  ...fieldProps
}: FieldProps & { readonly buildings: readonly Building[] }): JSX.Element {
  const options = scopeOptions(buildings);
  return (
    <SelectField field={FIELD_NAMES.scope} label={SCOPE_LABEL} {...fieldProps}>
      <NativeSelectOptGroup label={GROUPS_LABEL}>
        <ScopeOptionList options={options.groups} />
      </NativeSelectOptGroup>
      <NativeSelectOptGroup label={BUILDINGS_LABEL}>
        <ScopeOptionList options={options.buildings} />
      </NativeSelectOptGroup>
      {options.employeesByBuilding.map((group) => (
        <NativeSelectOptGroup
          key={group.building.id}
          label={`${EMPLOYEES_IN} ${group.label}`}
        >
          <ScopeOptionList options={group.options} />
        </NativeSelectOptGroup>
      ))}
    </SelectField>
  );
}

function KindField(fieldProps: FieldProps): JSX.Element {
  return (
    <SelectField
      field={FIELD_NAMES.directive}
      label={KIND_LABEL}
      {...fieldProps}
    >
      {labeledOptions(DIRECTIVE_KIND_LABELS).map(({ value, label }) => (
        <NativeSelectOption key={value} value={value}>
          {label}
        </NativeSelectOption>
      ))}
    </SelectField>
  );
}

interface DirectivesSectionProps {
  /** The facility's current decision, which every directive here qualifies. */
  readonly decision: Decision;
  readonly posture: Posture;
  /** False after a same-day re-evaluation nobody has decided on yet. */
  readonly isOnShownRecommendation: boolean;
  readonly directives: readonly Directive[];
  readonly buildings: readonly Building[];
  readonly recorders: readonly Recorder[];
  readonly timeZone: string;
  readonly submitDirective: (
    request: DirectiveRequest,
  ) => Promise<DirectiveOutcome>;
  readonly onReload: () => Promise<void>;
}

function DirectiveForm(props: DirectivesSectionProps): JSX.Element {
  const [state, dispatch] = useReducer(sectionReducer, { status: "editing" });
  const formId = useId();
  let invalidField: FormField | undefined;
  if (state.status === "invalid") {
    invalidField = state.field;
  }
  const fieldProps = { formId, invalidField };
  const noticeRef = useRef<HTMLDivElement>(null);
  let submitLabel = SUBMIT_LABEL;
  if (state.status === "submitting") {
    submitLabel = SUBMITTING_LABEL;
  }

  useEffect(() => {
    if (state.status === "invalid") {
      focusFieldError(formId, state.field);
    } else if (NOTICE_STATUSES.includes(state.status)) {
      noticeRef.current?.focus();
    }
  }, [formId, state]);

  const submit = useCallback(
    async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      const form = event.currentTarget;
      const read = readDirectiveForm(new FormData(form), props.buildings);
      if (read.kind === "invalid") {
        dispatch({ type: "reject", field: read.field });
        return;
      }
      dispatch({ type: "submit" });
      const outcome = await props.submitDirective(read.request);
      if (outcome.kind === "issued") {
        form.reset();
      }
      // Settle after the reload, so a notice that says the page is reloaded is already true.
      if (outcome.kind === "issued" || outcome.kind === "superseded") {
        await props.onReload();
      }
      dispatch({ type: "settle", outcome });
    },
    [props],
  );

  return (
    <form
      aria-label={SUBMIT_LABEL}
      className="max-w-xl space-y-4 rounded-lg border p-4"
      noValidate={true}
      onSubmit={submit}
    >
      <SectionNotice ref={noticeRef} state={state} />
      {/* A draft was written for one decision, so a new current decision starts it over. */}
      <div className="space-y-4" key={props.decision.id}>
        <ScopeField buildings={props.buildings} {...fieldProps} />
        <KindField {...fieldProps} />
        <ReasonFields required={true} {...fieldProps} />
        <RecordedByField recorders={props.recorders} {...fieldProps} />
      </div>
      <FieldError field="form" {...fieldProps} />
      <Button disabled={state.status === "submitting"} type="submit">
        {submitLabel}
      </Button>
    </form>
  );
}

export function DirectivesSection(props: DirectivesSectionProps): JSX.Element {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <h2 className="font-heading font-semibold text-xl" id={headingId}>
        {SECTION_HEADING}
      </h2>
      <p className="text-muted-foreground">{SECTION_INTRO}</p>
      <p>
        {`${STANDING_PREFIX} ${ACTION_LABELS[props.decision.action]}, ${POSTURE_LABELS[props.posture]}, ${RECORDED} ${formatFacilityTime(props.decision.decidedAt, props.timeZone)}.`}
      </p>
      {!props.isOnShownRecommendation && (
        <p className="text-muted-foreground">{NEWER_RECOMMENDATION_TEXT}</p>
      )}
      <DirectiveList
        buildings={props.buildings}
        directives={props.directives}
        timeZone={props.timeZone}
      />
      <DirectiveForm {...props} />
    </section>
  );
}
