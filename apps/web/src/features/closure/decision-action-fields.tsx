import type { JSX } from "react";
import { NativeSelectOption } from "@/components/ui/native-select";
import type { Posture } from "./decision-api";
import { FIELD_NAMES, type FormField } from "./decision-form";
import { SelectField } from "./form-fields";
import { labeledOptions, POSTURE_LABELS } from "./labels";
import { fittingRecheckMinutes } from "./recheck-times";

const POSTURE_FIELD_LABEL = "Posture instead";
const RECHECK_FIELD_LABEL = "Re-check in";
const MINUTES_SUFFIX = "min";

interface FieldProps {
  readonly formId: string;
  readonly invalidField: FormField | undefined;
}

function RecheckField({
  decideBy,
  now,
  ...fieldProps
}: FieldProps & {
  readonly decideBy: string;
  readonly now: number;
}): JSX.Element | null {
  const fitting = fittingRecheckMinutes(decideBy, now);
  // The panel says why Defer is closed, so the form adds nothing.
  if (fitting.length === 0) {
    return null;
  }
  return (
    <SelectField
      field={FIELD_NAMES.recheckIn}
      label={RECHECK_FIELD_LABEL}
      {...fieldProps}
    >
      {fitting.map((minutes) => (
        <NativeSelectOption key={minutes} value={minutes}>
          {`${minutes} ${MINUTES_SUFFIX}`}
        </NativeSelectOption>
      ))}
    </SelectField>
  );
}

function PostureField({
  recommendedPosture,
  ...fieldProps
}: FieldProps & { readonly recommendedPosture: Posture }): JSX.Element {
  return (
    <SelectField
      field={FIELD_NAMES.posture}
      label={POSTURE_FIELD_LABEL}
      {...fieldProps}
    >
      {labeledOptions(POSTURE_LABELS)
        .filter(({ value }) => value !== recommendedPosture)
        .map(({ value, label }) => (
          <NativeSelectOption key={value} value={value}>
            {label}
          </NativeSelectOption>
        ))}
    </SelectField>
  );
}

export { PostureField, RecheckField };
