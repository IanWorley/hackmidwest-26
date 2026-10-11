import type { JSX, ReactNode } from "react";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { Recorder } from "./decision-api";
import {
  controlId,
  errorId,
  FIELD_ERRORS,
  FIELD_NAMES,
  type FormField,
} from "./decision-form";
import { labeledOptions, REASON_CATEGORY_LABELS } from "./labels";

const RECORDED_BY_LABEL = "Recorded by";
const UNVERIFIED_NOTE =
  "Identity unverified: the record names whoever you pick here without checking it.";
const REASON_CATEGORY_LABEL = "Reason category";
const REASON_TEXT_LABEL = "Reason";
const OPTIONAL_SUFFIX = " (optional)";
const CHOOSE_PLACEHOLDER = "Choose…";

interface FieldProps {
  readonly formId: string;
  readonly invalidField: FormField | undefined;
}

function describedBy(ids: readonly (string | undefined)[]): string | undefined {
  const present = ids.filter((id) => id !== undefined);
  if (present.length === 0) {
    return undefined;
  }
  return present.join(" ");
}

function errorIdIfInvalid(
  { formId, invalidField }: FieldProps,
  field: FormField,
): string | undefined {
  if (invalidField === field) {
    return errorId(formId, field);
  }
  return undefined;
}

export function FieldError({
  formId,
  invalidField,
  field,
}: FieldProps & { readonly field: FormField }): JSX.Element | null {
  if (invalidField !== field) {
    return null;
  }
  let tabIndex: number | undefined;
  if (field === "form") {
    tabIndex = -1;
  }
  return (
    <p
      className="text-destructive text-sm"
      id={errorId(formId, field)}
      tabIndex={tabIndex}
    >
      {FIELD_ERRORS[field]}
    </p>
  );
}

export function SelectField({
  field,
  label,
  note,
  children,
  ...props
}: FieldProps & {
  readonly field: FormField;
  readonly label: string;
  readonly note?: string;
  readonly children: ReactNode;
}): JSX.Element {
  const id = controlId(props.formId, field);
  let noteId: string | undefined;
  if (note !== undefined) {
    noteId = `${id}-note`;
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        aria-describedby={describedBy([noteId, errorIdIfInvalid(props, field)])}
        aria-invalid={props.invalidField === field}
        defaultValue=""
        id={id}
        name={field}
      >
        <NativeSelectOption disabled={true} value="">
          {CHOOSE_PLACEHOLDER}
        </NativeSelectOption>
        {children}
      </NativeSelect>
      {noteId !== undefined && (
        <p className="text-muted-foreground text-sm" id={noteId}>
          {note}
        </p>
      )}
      <FieldError field={field} {...props} />
    </div>
  );
}

export function RecordedByField({
  recorders,
  ...props
}: FieldProps & {
  readonly recorders: readonly Recorder[];
}): JSX.Element {
  return (
    <SelectField
      field={FIELD_NAMES.recordedBy}
      label={RECORDED_BY_LABEL}
      note={UNVERIFIED_NOTE}
      {...props}
    >
      {recorders.map((maker) => (
        <NativeSelectOption key={maker.id} value={maker.id}>
          {`${maker.name}, ${maker.role}`}
        </NativeSelectOption>
      ))}
    </SelectField>
  );
}

export function ReasonFields({
  required,
  ...props
}: FieldProps & { readonly required: boolean }): JSX.Element {
  let suffix = OPTIONAL_SUFFIX;
  if (required) {
    suffix = "";
  }
  const textId = controlId(props.formId, FIELD_NAMES.reasonText);
  return (
    <>
      <SelectField
        field={FIELD_NAMES.reasonCategory}
        label={`${REASON_CATEGORY_LABEL}${suffix}`}
        {...props}
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
          aria-describedby={errorIdIfInvalid(props, FIELD_NAMES.reasonText)}
          aria-invalid={props.invalidField === FIELD_NAMES.reasonText}
          id={textId}
          name={FIELD_NAMES.reasonText}
        />
        <FieldError field={FIELD_NAMES.reasonText} {...props} />
      </div>
    </>
  );
}
