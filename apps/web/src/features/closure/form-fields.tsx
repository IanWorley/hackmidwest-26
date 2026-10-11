import type { JSX, ReactNode } from "react";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { DecisionMaker } from "./decision-api";
import { labeledOptions, REASON_CATEGORY_LABELS } from "./labels";

const RECORDED_BY_LABEL = "Recorded by";
const UNVERIFIED_NOTE =
  "Identity unverified: the record names who you pick here without checking it.";
const REASON_CATEGORY_LABEL = "Reason category";
const REASON_TEXT_LABEL = "Reason";
const OPTIONAL_SUFFIX = " (optional)";
const CHOOSE_PLACEHOLDER = "Choose…";

export const FIELD_NAMES = {
  recordedBy: "recordedBy",
  reasonCategory: "reasonCategory",
  reasonText: "reasonText",
} as const;

/** Ties an error to its control: the control's `aria-describedby` names this id. */
export function errorId(formId: string, field: string): string {
  return `${formId}-${field}-error`;
}

export function FieldError({
  formId,
  field,
  message,
}: {
  formId: string;
  field: string;
  message: string | undefined;
}): JSX.Element | null {
  if (message === undefined) {
    return null;
  }
  return (
    <p className="text-destructive text-sm" id={errorId(formId, field)}>
      {message}
    </p>
  );
}

export function SelectField({
  formId,
  name,
  label,
  error,
  note,
  children,
}: {
  formId: string;
  name: string;
  label: string;
  error: string | undefined;
  note?: string;
  children: ReactNode;
}): JSX.Element {
  const controlId = `${formId}-${name}`;
  const noteId = `${controlId}-note`;
  const describedBy = [
    note === undefined ? undefined : noteId,
    error === undefined ? undefined : errorId(formId, name),
  ]
    .filter((id) => id !== undefined)
    .join(" ");
  return (
    <div className="space-y-1.5">
      <Label htmlFor={controlId}>{label}</Label>
      <NativeSelect
        aria-describedby={describedBy === "" ? undefined : describedBy}
        aria-invalid={error !== undefined}
        defaultValue=""
        id={controlId}
        name={name}
      >
        <NativeSelectOption disabled={true} value="">
          {CHOOSE_PLACEHOLDER}
        </NativeSelectOption>
        {children}
      </NativeSelect>
      {note !== undefined && (
        <p className="text-muted-foreground text-sm" id={noteId}>
          {note}
        </p>
      )}
      <FieldError field={name} formId={formId} message={error} />
    </div>
  );
}

export function RecordedByField({
  formId,
  decisionMakers,
  error,
}: {
  formId: string;
  decisionMakers: readonly DecisionMaker[];
  error: string | undefined;
}): JSX.Element {
  return (
    <SelectField
      error={error}
      formId={formId}
      label={RECORDED_BY_LABEL}
      name={FIELD_NAMES.recordedBy}
      note={UNVERIFIED_NOTE}
    >
      {decisionMakers.map((maker) => (
        <NativeSelectOption key={maker.id} value={maker.id}>
          {`${maker.name}, ${maker.role}`}
        </NativeSelectOption>
      ))}
    </SelectField>
  );
}

export function ReasonFields({
  formId,
  required,
  categoryError,
  textError,
}: {
  formId: string;
  required: boolean;
  categoryError: string | undefined;
  textError: string | undefined;
}): JSX.Element {
  const suffix = required ? "" : OPTIONAL_SUFFIX;
  const textId = `${formId}-${FIELD_NAMES.reasonText}`;
  return (
    <>
      <SelectField
        error={categoryError}
        formId={formId}
        label={`${REASON_CATEGORY_LABEL}${suffix}`}
        name={FIELD_NAMES.reasonCategory}
      >
        {labeledOptions(REASON_CATEGORY_LABELS).map(({ value, label }) => (
          <NativeSelectOption key={value} value={value}>
            {label}
          </NativeSelectOption>
        ))}
      </SelectField>
      <div className="space-y-1.5">
        <Label htmlFor={textId}>{`${REASON_TEXT_LABEL}${suffix}`}</Label>
        <Textarea
          aria-describedby={
            textError === undefined
              ? undefined
              : errorId(formId, FIELD_NAMES.reasonText)
          }
          aria-invalid={textError !== undefined}
          id={textId}
          name={FIELD_NAMES.reasonText}
        />
        <FieldError
          field={FIELD_NAMES.reasonText}
          formId={formId}
          message={textError}
        />
      </div>
    </>
  );
}
