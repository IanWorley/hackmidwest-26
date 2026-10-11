import type {
  DecisionRequest,
  HumanAction,
  Posture,
  ReasonCategory,
} from "./decision-api";
import { FIELD_NAMES } from "./form-fields";
import { POSTURE_LABELS, parseOption, REASON_CATEGORY_LABELS } from "./labels";

const MS_PER_MINUTE = 60_000;
const DECIMAL_ID_PATTERN = /^[1-9]\d*$/u;

export const DECISION_FIELD_NAMES = {
  ...FIELD_NAMES,
  posture: "posture",
  recheckIn: "recheckIn",
} as const;

/** Every control a decision or directive form can flag, plus `form` for an error no control owns. */
export type FormField =
  | (typeof DECISION_FIELD_NAMES)[keyof typeof DECISION_FIELD_NAMES]
  | "scope"
  | "directive"
  | "form";

/** The API names request fields; the form names its controls. Unknown paths fall back to the whole form. */
const API_FIELD_CONTROLS: Record<string, FormField> = {
  decidedById: "recordedBy",
  issuedById: "recordedBy",
  posture: "posture",
  recheckAt: "recheckIn",
  reason: "reasonText",
  "reason.category": "reasonCategory",
  "reason.text": "reasonText",
  scope: "scope",
  directive: "directive",
};

export function controlForApiField(field: string): FormField {
  return API_FIELD_CONTROLS[field] ?? "form";
}

export type FormRead<Request> =
  | { readonly kind: "ok"; readonly request: Request }
  | { readonly kind: "invalid"; readonly field: FormField };

function text(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function readDecisionMakerId(data: FormData): number | undefined {
  const value = text(data, FIELD_NAMES.recordedBy);
  return DECIMAL_ID_PATTERN.test(value) ? Number(value) : undefined;
}

type Reason = { category: ReasonCategory; text: string };

/** An optional reason is all or nothing: half a reason is an error, not a silent drop. */
export function readReason(
  data: FormData,
  required: boolean,
): FormRead<Reason | undefined> {
  const category = parseOption(
    REASON_CATEGORY_LABELS,
    data.get(FIELD_NAMES.reasonCategory),
  );
  const reasonText = text(data, FIELD_NAMES.reasonText);
  if (!required && category === undefined && reasonText === "") {
    return { kind: "ok", request: undefined };
  }
  if (category === undefined) {
    return { kind: "invalid", field: "reasonCategory" };
  }
  if (reasonText === "") {
    return { kind: "invalid", field: "reasonText" };
  }
  return { kind: "ok", request: { category, text: reasonText } };
}

/** A change to a standing decision needs a reason even when it accepts, as the API requires. */
export function reasonRequired(
  action: HumanAction,
  supersedesDecisionId: number | undefined,
): boolean {
  return action !== "accept" || supersedesDecisionId !== undefined;
}

export function readDecisionForm(
  action: HumanAction,
  data: FormData,
  {
    supersedesDecisionId,
    submittedAt,
  }: { supersedesDecisionId: number | undefined; submittedAt: number },
): FormRead<DecisionRequest> {
  const decidedById = readDecisionMakerId(data);
  if (decidedById === undefined) {
    return { kind: "invalid", field: "recordedBy" };
  }
  const reason = readReason(data, reasonRequired(action, supersedesDecisionId));
  const shared = {
    decidedById,
    ...(supersedesDecisionId === undefined ? {} : { supersedesDecisionId }),
  };
  switch (action) {
    case "accept":
      if (reason.kind === "invalid") {
        return reason;
      }
      return {
        kind: "ok",
        request: {
          action,
          ...(reason.request === undefined ? {} : { reason: reason.request }),
          ...shared,
        },
      };
    case "override": {
      const posture: Posture | undefined = parseOption(
        POSTURE_LABELS,
        data.get(DECISION_FIELD_NAMES.posture),
      );
      if (posture === undefined) {
        return { kind: "invalid", field: "posture" };
      }
      if (reason.kind === "invalid") {
        return reason;
      }
      if (reason.request === undefined) {
        return { kind: "invalid", field: "reasonText" };
      }
      return {
        kind: "ok",
        request: { action, posture, reason: reason.request, ...shared },
      };
    }
    case "defer": {
      const minutes = Number(text(data, DECISION_FIELD_NAMES.recheckIn));
      if (!Number.isSafeInteger(minutes) || minutes <= 0) {
        return { kind: "invalid", field: "recheckIn" };
      }
      if (reason.kind === "invalid") {
        return reason;
      }
      if (reason.request === undefined) {
        return { kind: "invalid", field: "reasonText" };
      }
      const recheckAt = new Date(
        submittedAt + minutes * MS_PER_MINUTE,
      ).toISOString();
      return {
        kind: "ok",
        request: { action, recheckAt, reason: reason.request, ...shared },
      };
    }
    default:
      return action satisfies never;
  }
}
