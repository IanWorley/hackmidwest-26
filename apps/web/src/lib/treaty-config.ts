/**
 * Eden turns date-like strings into `Date` objects by default while its types still say `string`.
 * Keeping them strings makes the runtime value match the contract the screens are typed against.
 */
export const TREATY_CONFIG = { parseDate: false } as const;
