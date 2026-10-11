import type {
  DecisionRequest,
  HumanAction,
  Posture,
  ReasonCategory,
} from "./decision-api";
import { POSTURE_LABELS, parseOption, REASON_CATEGORY_LABELS } from "./labels";

const MS_PER_MINUTE = 60_000;
const DECIMAL_ID_PATTERN = /^[1-9]\d*$/u;

/** The `name` of every form control, which is also the key its error is reported under. */
const FIELD_NAMES = {
  recordedBy: "recordedBy",
  reasonCategory: "reasonCategory",
  reasonText: "reasonText",
  posture: "posture",
  recheckIn: "recheckIn",
  scope: "scope",
  directive: "directive",
} as const;

/** Every control a form can flag, plus `form` for a refusal no control owns. */
type FormField = (typeof FIELD_NAMES)[keyof typeof FIELD_NAMES] | "form";

const FIELD_ERRORS: Record<FormField, string> = {
  recordedBy: "Choose who is recording this.",
  reasonCategory: "Choose a reason category.",
  reasonText: "Enter a reason.",
  posture: "Choose a posture other than the recommended one.",
  recheckIn: "Choose a re-check time before the decision deadline.",
  scope: "Choose who this applies to.",
  directive: "Choose a directive.",
  form: "The request was refused. Check every field and try again.",
};

type FormRead<Request> =
  | { readonly kind: "ok"; readonly request: Request }
  | { readonly kind: "invalid"; readonly field: FormField };

interface Reason {
  readonly category: ReasonCategory;
  readonly text: string;
}

interface DecisionContext {
  readonly supersedesDecisionId: number | undefined;
  readonly submittedAt: number;
}

/** Ties an error to its control: the control's `aria-describedby` names this id. */
function errorId(formId: string, field: FormField): string {
  return `${formId}-${field}-error`;
}

function textOf(data: FormData, name: string): string {
  const value = data.get(name);
  if (typeof value === "string") {
    return value.trim();
  }
  return "";
}

function readDecisionMakerId(data: FormData): number | undefined {
  const value = textOf(data, FIELD_NAMES.recordedBy);
  if (DECIMAL_ID_PATTERN.test(value)) {
    return Number(value);
  }
  return undefined;
}

/** An optional reason is all or nothing: half a reason is an error, not a silent drop. */
function readOptionalReason(data: FormData): FormRead<Reason | undefined> {
  const category = parseOption(
    REASON_CATEGORY_LABELS,
    data.get(FIELD_NAMES.reasonCategory),
  );
  const text = textOf(data, FIELD_NAMES.reasonText);
  if (category === undefined && text === "") {
    return { kind: "ok", request: undefined };
  }
  if (category === undefined) {
    return { kind: "invalid", field: "reasonCategory" };
  }
  if (text === "") {
    return { kind: "invalid", field: "reasonText" };
  }
  return { kind: "ok", request: { category, text } };
}

function readReason(data: FormData): FormRead<Reason> {
  const reason = readOptionalReason(data);
  if (reason.kind === "invalid") {
    return reason;
  }
  if (reason.request === undefined) {
    return { kind: "invalid", field: "reasonText" };
  }
  return { kind: "ok", request: reason.request };
}

/** A change to a standing decision needs a reason even when it accepts, as the API requires. */
function reasonRequired(
  action: HumanAction,
  supersedesDecisionId: number | undefined,
): boolean {
  return action !== "accept" || supersedesDecisionId !== undefined;
}

function sharedFields(
  decidedById: number,
  supersedesDecisionId: number | undefined,
): { decidedById: number; supersedesDecisionId?: number } {
  if (supersedesDecisionId === undefined) {
    return { decidedById };
  }
  return { decidedById, supersedesDecisionId };
}

function readAccept(
  data: FormData,
  supersedesDecisionId: number | undefined,
): FormRead<Reason | undefined> {
  if (reasonRequired("accept", supersedesDecisionId)) {
    return readReason(data);
  }
  return readOptionalReason(data);
}

function readOverride(
  data: FormData,
): FormRead<{ posture: Posture; reason: Reason }> {
  const posture = parseOption(POSTURE_LABELS, data.get(FIELD_NAMES.posture));
  if (posture === undefined) {
    return { kind: "invalid", field: "posture" };
  }
  const reason = readReason(data);
  if (reason.kind === "invalid") {
    return reason;
  }
  return { kind: "ok", request: { posture, reason: reason.request } };
}

function readDefer(
  data: FormData,
  submittedAt: number,
): FormRead<{ recheckAt: string; reason: Reason }> {
  const minutes = Number(textOf(data, FIELD_NAMES.recheckIn));
  if (!Number.isSafeInteger(minutes) || minutes <= 0) {
    return { kind: "invalid", field: "recheckIn" };
  }
  const reason = readReason(data);
  if (reason.kind === "invalid") {
    return reason;
  }
  const recheckAt = new Date(submittedAt + minutes * MS_PER_MINUTE);
  return {
    kind: "ok",
    request: { recheckAt: recheckAt.toISOString(), reason: reason.request },
  };
}

/** The form is a boundary: its strings become one typed request or the first field at fault. */
function readDecisionForm(
  action: HumanAction,
  data: FormData,
  { supersedesDecisionId, submittedAt }: DecisionContext,
): FormRead<DecisionRequest> {
  const decidedById = readDecisionMakerId(data);
  if (decidedById === undefined) {
    return { kind: "invalid", field: "recordedBy" };
  }
  const shared = sharedFields(decidedById, supersedesDecisionId);
  switch (action) {
    case "accept": {
      const read = readAccept(data, supersedesDecisionId);
      if (read.kind === "invalid") {
        return read;
      }
      if (read.request === undefined) {
        return { kind: "ok", request: { action, ...shared } };
      }
      return {
        kind: "ok",
        request: { action, reason: read.request, ...shared },
      };
    }
    case "override": {
      const read = readOverride(data);
      if (read.kind === "invalid") {
        return read;
      }
      return { kind: "ok", request: { action, ...read.request, ...shared } };
    }
    case "defer": {
      const read = readDefer(data, submittedAt);
      if (read.kind === "invalid") {
        return read;
      }
      return { kind: "ok", request: { action, ...read.request, ...shared } };
    }
    default:
      return action satisfies never;
  }
}

export type { FormField, FormRead, Reason };
export {
  errorId,
  FIELD_ERRORS,
  FIELD_NAMES,
  readDecisionForm,
  readDecisionMakerId,
  readReason,
  reasonRequired,
};
