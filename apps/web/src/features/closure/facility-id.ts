/** Decimal digits only, so `0x1` or `1e0` cannot alias facility 1 through `Number`. */
const FACILITY_ID_PATTERN = /^[1-9]\d*$/u;

/** A path segment is a facility id only when it is a decimal positive safe integer. */
export function parseFacilityId(segment: string): number | undefined {
  const id = Number(segment);
  if (FACILITY_ID_PATTERN.test(segment) && Number.isSafeInteger(id)) {
    return id;
  }
  return undefined;
}
