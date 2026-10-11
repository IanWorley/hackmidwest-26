import type { JSX } from "react";
import type { Building, Directive } from "./decision-api";
import { scopeLabel } from "./directive-form";
import { formatFacilityTime } from "./format-time";
import { DIRECTIVE_KIND_LABELS, REASON_CATEGORY_LABELS } from "./labels";

const LIST_LABEL = "Issued directives";
const NO_DIRECTIVES_TEXT = "No directives on this decision yet.";
const ISSUED_BY = "issued by";
const UNVERIFIED_SUFFIX = "(unverified)";
const RELEASED_AT = "released at";

function directiveText(
  directive: Directive,
  buildings: readonly Building[],
  timeZone: string,
): string {
  const text = `${scopeLabel(directive.scope, buildings)}: ${DIRECTIVE_KIND_LABELS[directive.directive]}`;
  if (directive.effectiveAt === null) {
    return text;
  }
  return `${text}, ${RELEASED_AT} ${formatFacilityTime(directive.effectiveAt, timeZone)}`;
}

export function DirectiveList({
  directives,
  buildings,
  timeZone,
}: {
  directives: readonly Directive[];
  buildings: readonly Building[];
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
            {directiveText(directive, buildings, timeZone)}
          </p>
          <p>{`${REASON_CATEGORY_LABELS[directive.reasonCategory]}: ${directive.reasonText}`}</p>
          <p className="text-muted-foreground text-sm">
            {`${formatFacilityTime(directive.issuedAt, timeZone)}, ${ISSUED_BY} ${directive.issuedByName}, ${directive.issuedByRole} ${UNVERIFIED_SUFFIX}`}
          </p>
        </li>
      ))}
    </ul>
  );
}
