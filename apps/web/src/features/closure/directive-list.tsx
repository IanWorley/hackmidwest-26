import type { JSX } from "react";
import type { Building, Directive, Recorder } from "./decision-api";
import { scopeLabel } from "./directive-form";
import { formatFacilityTime } from "./format-time";
import { DIRECTIVE_KIND_LABELS } from "./labels";

const LIST_LABEL = "Issued directives";
const NO_DIRECTIVES_TEXT = "No directives on this decision yet.";
const ISSUED_BY = "issued by";
const UNVERIFIED_SUFFIX = "(unverified)";
const UNKNOWN_PERSON = "an unknown decision maker";

function issuerName(
  recorders: readonly Recorder[],
  issuedById: number,
): string {
  return recorders.find(({ id }) => id === issuedById)?.name ?? UNKNOWN_PERSON;
}

export function DirectiveList({
  directives,
  buildings,
  recorders,
  timeZone,
}: {
  directives: readonly Directive[];
  buildings: readonly Building[];
  recorders: readonly Recorder[];
  timeZone: string;
}): JSX.Element {
  if (directives.length === 0) {
    return <p className="text-muted-foreground">{NO_DIRECTIVES_TEXT}</p>;
  }
  return (
    <ul aria-label={LIST_LABEL} className="space-y-2">
      {directives.map((directive) => (
        <li className="rounded-lg border p-3" key={directive.id}>
          <p className="font-medium">
            {`${scopeLabel(directive.scope, buildings)}: ${DIRECTIVE_KIND_LABELS[directive.directive]}`}
          </p>
          <p>{directive.reasonText}</p>
          <p className="text-muted-foreground text-sm">
            {`${formatFacilityTime(directive.issuedAt, timeZone)}, ${ISSUED_BY} ${issuerName(recorders, directive.issuedById)} ${UNVERIFIED_SUFFIX}`}
          </p>
        </li>
      ))}
    </ul>
  );
}
