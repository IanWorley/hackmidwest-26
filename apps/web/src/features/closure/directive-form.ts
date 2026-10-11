import type {
  Building,
  DirectiveOutcome,
  DirectiveRequest,
  DirectiveScope,
} from "./decision-api";
import {
  FIELD_NAMES,
  type FormField,
  type FormRead,
  readDecisionMakerId,
  readReason,
} from "./decision-form";
import { DIRECTIVE_KIND_LABELS, parseOption } from "./labels";

const FACILITY_SCOPE_LABEL = "Whole facility";
const ESSENTIAL_SCOPE_LABEL = "Essential personnel";
const UNKNOWN_SCOPE_LABEL = "Someone no longer listed";

interface ScopeOption {
  readonly key: string;
  readonly label: string;
  readonly scope: DirectiveScope;
}

interface ScopeOptions {
  readonly groups: readonly ScopeOption[];
  readonly buildings: readonly ScopeOption[];
  readonly employeesByBuilding: readonly {
    readonly building: Building;
    readonly options: readonly ScopeOption[];
  }[];
}

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

/** Each submit starts over, so the section only remembers how the last one ended. */
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
        return { status: "invalid", field: event.outcome.field };
      }
      return { status: event.outcome.kind };
    default:
      return event satisfies never;
  }
}

/** Select values are strings, so each scope gets a key and the submit looks the typed scope back up. */
function scopeOptions(buildings: readonly Building[]): ScopeOptions {
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

function allScopeOptions(options: ScopeOptions): ScopeOption[] {
  return [
    ...options.groups,
    ...options.buildings,
    ...options.employeesByBuilding.flatMap((group) => group.options),
  ];
}

function sameScope(left: DirectiveScope, right: DirectiveScope): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function scopeLabel(
  scope: DirectiveScope,
  buildings: readonly Building[],
): string {
  return (
    allScopeOptions(scopeOptions(buildings)).find((option) =>
      sameScope(option.scope, scope),
    )?.label ?? UNKNOWN_SCOPE_LABEL
  );
}

function readDirectiveForm(
  data: FormData,
  buildings: readonly Building[],
): FormRead<DirectiveRequest> {
  const scopeKey = data.get(FIELD_NAMES.scope);
  const scope = allScopeOptions(scopeOptions(buildings)).find(
    (option) => option.key === scopeKey,
  )?.scope;
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
  const reason = readReason(data);
  if (reason.kind === "invalid") {
    return reason;
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

export type { ScopeOption, SectionEvent, SectionState };
export { readDirectiveForm, scopeLabel, scopeOptions, sectionReducer };
