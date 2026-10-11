import {
  type JSX,
  type SubmitEvent,
  useCallback,
  useId,
  useReducer,
} from "react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import type {
  Building,
  Directive,
  DirectiveOutcome,
  DirectiveRequest,
  Recorder,
} from "./decision-api";
import { FIELD_NAMES, type FormField } from "./decision-form";
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
import { DIRECTIVE_KIND_LABELS, labeledOptions } from "./labels";

const SECTION_HEADING = "Directives";
const SECTION_INTRO =
  "Tell a building, the essential group, or one employee to do something other than the posture says. The most specific directive wins.";
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

interface FieldProps {
  readonly formId: string;
  readonly invalidField: FormField | undefined;
}

function SectionNotice({ state }: { state: SectionState }): JSX.Element | null {
  switch (state.status) {
    case "issued":
      return <p role="status">{ISSUED_TEXT}</p>;
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
          label={`${EMPLOYEES_IN} ${group.building.name}`}
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
  readonly directives: readonly Directive[];
  readonly buildings: readonly Building[];
  readonly recorders: readonly Recorder[];
  readonly timeZone: string;
  /** Issues the directive on the current decision. */
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
  let submitLabel = SUBMIT_LABEL;
  if (state.status === "submitting") {
    submitLabel = SUBMITTING_LABEL;
  }

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
      dispatch({ type: "settle", outcome });
      if (outcome.kind === "issued") {
        form.reset();
      }
      if (outcome.kind === "issued" || outcome.kind === "superseded") {
        await props.onReload();
      }
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
      <SectionNotice state={state} />
      <ScopeField buildings={props.buildings} {...fieldProps} />
      <KindField {...fieldProps} />
      <ReasonFields required={true} {...fieldProps} />
      <RecordedByField recorders={props.recorders} {...fieldProps} />
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
      <DirectiveList
        buildings={props.buildings}
        directives={props.directives}
        recorders={props.recorders}
        timeZone={props.timeZone}
      />
      <DirectiveForm {...props} />
    </section>
  );
}
