/** Rejects any field a schema does not list, so a renamed or invented field fails validation instead of passing unread. */
const CLOSED = { additionalProperties: false } as const;

export { CLOSED };
