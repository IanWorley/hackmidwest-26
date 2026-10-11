import type { FormField } from "./decision-form";

/** The API reports a refused field as a JSON Pointer into the body; the forms name their controls. */
const API_FIELD_CONTROLS: ReadonlyMap<string, FormField> = new Map([
  ["/decidedById", "recordedBy"],
  ["/issuedById", "recordedBy"],
  ["/chosenPosture", "posture"],
  ["/recheckAt", "recheckIn"],
  ["/reason", "reasonText"],
  ["/reason/category", "reasonCategory"],
  ["/reason/text", "reasonText"],
  ["/scope", "scope"],
  ["/directive", "directive"],
]);
const POINTER_SEPARATOR = "/";
const TOP_LEVEL_SEGMENTS = 2;

/** A pointer deeper than any control, such as `/scope/buildingId`, falls back to its top-level field. */
function controlFor(property: unknown): FormField {
  if (typeof property !== "string") {
    return "form";
  }
  const topLevel = property
    .split(POINTER_SEPARATOR)
    .slice(0, TOP_LEVEL_SEGMENTS)
    .join(POINTER_SEPARATOR);
  return (
    API_FIELD_CONTROLS.get(property) ??
    API_FIELD_CONTROLS.get(topLevel) ??
    "form"
  );
}

export { controlFor };
