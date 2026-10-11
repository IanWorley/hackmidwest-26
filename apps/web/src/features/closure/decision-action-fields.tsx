import type { JSX } from "react";
import { NativeSelectOption } from "@/components/ui/native-select";
import type { Posture } from "./decision-api";
import { FIELD_NAMES, type FormField } from "./decision-form";
import { SelectField } from "./form-fields";
import { labeledOptions, POSTURE_LABELS } from "./labels";

const MS_PER_MINUTE = 60_000;
const QUARTER_HOUR_MINUTES = 15;
const HALF_HOUR_MINUTES = 30;
const HOUR_MINUTES = 60;
const TWO_HOURS_MINUTES = 120;
const RECHECK_MINUTES = [
  QUARTER_HOUR_MINUTES,
  HALF_HOUR_MINUTES,
  HOUR_MINUTES,
  TWO_HOURS_MINUTES,
] as const;

const POSTURE_FIELD_LABEL = "Posture instead";
const RECHECK_FIELD_LABEL = "Re-check in";
const MINUTES_SUFFIX = "min";
const NO_RECHECK_TEXT =
  "No re-check time fits before the decision deadline, so this cannot be deferred.";

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
}): JSX.Element {
  const remainingMinutes = (Date.parse(decideBy) - now) / MS_PER_MINUTE;
  const fitting = RECHECK_MINUTES.filter(
    (minutes) => minutes < remainingMinutes,
  );
  if (fitting.length === 0) {
    return <p>{NO_RECHECK_TEXT}</p>;
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
