import { type FormEvent, type JSX, useId, useReducer } from "react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import type {
  Building,
  Decision,
  DecisionMaker,
  Directive,
  DirectiveOutcome,
  DirectiveRequest,
  DirectiveScope,
} from "./decision-api";
import {
  controlForApiField,
  type FormField,
  readDecisionMakerId,
  readReason,
} from "./decision-form";
import {
  FieldError,
  ReasonFields,
  RecordedByField,
  SelectField,
} from "./form-fields";
import { formatFacilityTime } from "./format-time";
import { DIRECTIVE_KIND_LABELS, labeledOptions, parseOption } from "./labels";

const SECTION_HEADING = "Directives";
const SECTION_INTRO =
  "Tell a building, the essential group, or one employee to do something other than the posture says. The most specific directive wins.";
const NO_DIRECTIVES_TEXT = "No directives on this decision yet.";
const SCOPE_LABEL = "Applies to";
const KIND_LABEL = "Directive";
const SUBMIT_LABEL = "Issue directive";
const SUBMITTING_LABEL = "Issuing…";
const ISSUED_TEXT = "Directive issued.";
const SUPERSEDED_TITLE =
  "This decision was changed by someone else. Nothing was saved; the page is reloaded with the current decision.";
const FAILED_TITLE = "The directive could not be issued. Try again.";
const FACILITY_SCOPE_LABEL = "Whole facility";
const ESSENTIAL_SCOPE_LABEL = "Essential personnel";
const GROUPS_LABEL = "Groups";
const BUILDINGS_LABEL = "Buildings";
const EMPLOYEES_IN = "Employees in";
const ISSUED_BY = "issued by";
const UNKNOWN_PERSON = "an unknown decision maker";

const FIELD_ERRORS: Partial<Record<FormField, string>> = {
  recordedBy: "Choose who is recording this.",
  scope: "Choose who this applies to.",
  directive: "Choose a directive.",
  reasonCategory: "Choose a reason category.",
  reasonText: "Enter a reason.",
  form: "The request was refused. Check every field and try again.",
};

const FIELD_NAMES = { scope: "scope", directive: "directive" } as const;

type SectionState =
  | { readonly status: "editing" }
  | { readonly status: "submitting" }
  | { readonly status: "invalid"; readonly field: FormField }
  | { readonly status: "issued" }
  | { readonly status: "superseded" }
  | { readonly status: "failed" };

type SectionEvent =
  | { readonly type: "submit" }
  | { readonly type: "reject"; readonly field: FormField }
  | { readonly type: "settle"; readonly outcome: DirectiveOutcome };

function sectionReducer(
  _state: SectionState,
  event: SectionEvent,
): SectionState {
  switch (event.type) {
    case "submit":
      return { status: "submitting" };
    case "reject":
      return { status: "invalid", field: event.field };
    case "settle":
      if (event.outcome.kind === "invalid") {
        return {
          status: "invalid",
          field: controlForApiField(event.outcome.field),
        };
      }
      return { status: event.outcome.kind };
    default:
      return event satisfies never;
  }
}

interface ScopeOption {
  readonly key: string;
  readonly label: string;
  readonly scope: DirectiveScope;
}

/** Select values are strings, so each scope gets a key and the submit looks the typed scope back up. */
function scopeOptions(buildings: readonly Building[]): {
  groups: ScopeOption[];
  buildings: ScopeOption[];
  employeesByBuilding: { building: Building; options: ScopeOption[] }[];
} {
  return {
    groups: [
      {
        key: "facility",
        label: FACILITY_SCOPE_LABEL,
        scope: { kind: "facility" },
      },
      {
        key: "group:essential",
        label: ESSENTIAL_SCOPE_LABEL,
        scope: { kind: "group", group: "essential" },
      },
    ],
    buildings: buildings.map((building) => ({
      key: `building:${building.id}`,
      label: building.name,
      scope: { kind: "building", buildingId: building.id },
    })),
    employeesByBuilding: buildings.map((building) => ({
      building,
      options: building.employees.map((employee) => ({
        key: `employee:${employee.id}`,
        label: employee.name,
        scope: { kind: "employee", employeeId: employee.id },
      })),
    })),
  };
}

function scopeLabel(
  scope: DirectiveScope,
  buildings: readonly Building[],
): string {
  switch (scope.kind) {
    case "facility":
      return FACILITY_SCOPE_LABEL;
    case "group":
      return ESSENTIAL_SCOPE_LABEL;
    case "building":
      return (
        buildings.find(({ id }) => id === scope.buildingId)?.name ??
        `${BUILDINGS_LABEL} ${scope.buildingId}`
      );
    case "employee":
      return (
        buildings
          .flatMap(({ employees }) => employees)
          .find(({ id }) => id === scope.employeeId)?.name ??
        `${scope.employeeId}`
      );
    default:
      return scope satisfies never;
  }
}

function readDirectiveForm(
  data: FormData,
  scopes: ReadonlyMap<string, DirectiveScope>,
):
  | { readonly kind: "ok"; readonly request: DirectiveRequest }
  | { readonly kind: "invalid"; readonly field: FormField } {
  const scopeKey = data.get(FIELD_NAMES.scope);
  const scope = typeof scopeKey === "string" ? scopes.get(scopeKey) : undefined;
  if (scope === undefined) {
    return { kind: "invalid", field: "scope" };
  }
  const directive = parseOption(
    DIRECTIVE_KIND_LABELS,
    data.get(FIELD_NAMES.directive),
  );
  if (directive === undefined) {
    return { kind: "invalid", field: "directive" };
  }
  const reason = readReason(data, true);
  if (reason.kind === "invalid") {
    return reason;
  }
  if (reason.request === undefined) {
    return { kind: "invalid", field: "reasonText" };
  }
  const issuedById = readDecisionMakerId(data);
  if (issuedById === undefined) {
    return { kind: "invalid", field: "recordedBy" };
  }
  return {
    kind: "ok",
    request: { scope, directive, reason: reason.request, issuedById },
  };
}

function DirectiveList({
  directives,
  buildings,
  decisionMakers,
  timeZone,
}: {
  directives: readonly Directive[];
  buildings: readonly Building[];
  decisionMakers: readonly DecisionMaker[];
  timeZone: string;
}): JSX.Element {
  if (directives.length === 0) {
    return <p className="text-muted-foreground">{NO_DIRECTIVES_TEXT}</p>;
  }
  return (
    <ul aria-label={SECTION_HEADING} className="space-y-2">
      {directives.map((directive) => (
        <li className="rounded-lg border p-3" key={directive.id}>
          <p className="font-medium">
            {`${scopeLabel(directive.scope, buildings)}: ${DIRECTIVE_KIND_LABELS[directive.directive]}`}
          </p>
          <p>{directive.reasonText}</p>
          <p className="text-muted-foreground text-sm">
            {`${formatFacilityTime(directive.issuedAt, timeZone)}, ${ISSUED_BY} ${
              decisionMakers.find(({ id }) => id === directive.issuedById)
                ?.name ?? UNKNOWN_PERSON
            }`}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function DirectivesSection({
  decision,
  directives,
  buildings,
  decisionMakers,
  timeZone,
  onIssue,
  onReload,
}: {
  decision: Decision;
  directives: readonly Directive[];
  buildings: readonly Building[];
  decisionMakers: readonly DecisionMaker[];
  timeZone: string;
  onIssue: (
    decisionId: number,
    request: DirectiveRequest,
  ) => Promise<DirectiveOutcome>;
  onReload: () => Promise<void>;
}): JSX.Element {
  const [state, dispatch] = useReducer(sectionReducer, { status: "editing" });
  const formId = useId();
  const options = scopeOptions(buildings);
  const scopes = new Map(
    [
      ...options.groups,
      ...options.buildings,
      ...options.employeesByBuilding.flatMap(({ options: o }) => o),
    ].map(({ key, scope }) => [key, scope]),
  );
  const invalidField = state.status === "invalid" ? state.field : undefined;
  const errorFor = (field: FormField): string | undefined =>
    invalidField === field ? FIELD_ERRORS[field] : undefined;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const read = readDirectiveForm(new FormData(form), scopes);
    if (read.kind === "invalid") {
      dispatch({ type: "reject", field: read.field });
      return;
    }
    dispatch({ type: "submit" });
    const outcome = await onIssue(decision.id, read.request);
    dispatch({ type: "settle", outcome });
    if (outcome.kind === "issued") {
      form.reset();
    }
    if (outcome.kind === "issued" || outcome.kind === "superseded") {
      await onReload();
    }
  }

  return (
    <section aria-labelledby={`${formId}-heading`} className="space-y-4">
      <h2
        className="font-heading font-semibold text-xl"
        id={`${formId}-heading`}
      >
        {SECTION_HEADING}
      </h2>
      <p className="text-muted-foreground">{SECTION_INTRO}</p>
      <DirectiveList
        buildings={buildings}
        decisionMakers={decisionMakers}
        directives={directives}
        timeZone={timeZone}
      />
      {state.status === "issued" && <p role="status">{ISSUED_TEXT}</p>}
      {state.status === "superseded" && (
        <Alert role="alert">
          <AlertTitle>{SUPERSEDED_TITLE}</AlertTitle>
        </Alert>
      )}
      {state.status === "failed" && (
        <Alert role="alert" variant="destructive">
          <AlertTitle>{FAILED_TITLE}</AlertTitle>
        </Alert>
      )}
      <form
        aria-label={SUBMIT_LABEL}
        className="max-w-xl space-y-4 rounded-lg border p-4"
        noValidate={true}
        onSubmit={submit}
      >
        <SelectField
          error={errorFor("scope")}
          formId={formId}
          label={SCOPE_LABEL}
          name={FIELD_NAMES.scope}
        >
          <NativeSelectOptGroup label={GROUPS_LABEL}>
            {options.groups.map(({ key, label }) => (
              <NativeSelectOption key={key} value={key}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelectOptGroup>
          <NativeSelectOptGroup label={BUILDINGS_LABEL}>
            {options.buildings.map(({ key, label }) => (
              <NativeSelectOption key={key} value={key}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelectOptGroup>
          {options.employeesByBuilding.map(({ building, options: people }) => (
            <NativeSelectOptGroup
              key={building.id}
              label={`${EMPLOYEES_IN} ${building.name}`}
            >
              {people.map(({ key, label }) => (
                <NativeSelectOption key={key} value={key}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelectOptGroup>
          ))}
        </SelectField>
        <SelectField
          error={errorFor("directive")}
          formId={formId}
          label={KIND_LABEL}
          name={FIELD_NAMES.directive}
        >
          {labeledOptions(DIRECTIVE_KIND_LABELS).map(({ value, label }) => (
            <NativeSelectOption key={value} value={value}>
              {label}
            </NativeSelectOption>
          ))}
        </SelectField>
        <ReasonFields
          categoryError={errorFor("reasonCategory")}
          formId={formId}
          required={true}
          textError={errorFor("reasonText")}
        />
        <RecordedByField
          decisionMakers={decisionMakers}
          error={errorFor("recordedBy")}
          formId={formId}
        />
        <FieldError field="form" formId={formId} message={errorFor("form")} />
        <Button disabled={state.status === "submitting"} type="submit">
          {state.status === "submitting" ? SUBMITTING_LABEL : SUBMIT_LABEL}
        </Button>
      </form>
    </section>
  );
}
