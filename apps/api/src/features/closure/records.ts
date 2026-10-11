import { createHash } from "node:crypto";

const HASH_ALGORITHM = "sha256";
const HASH_ENCODING = "hex";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function byKey(
  [left]: [string, unknown],
  [right]: [string, unknown],
): -1 | 0 | 1 {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/** JSON with object keys sorted at every depth, so equal values always produce the same text. */
function canonicalJson(value: object): string {
  return JSON.stringify(value, (_key, nested: unknown) => {
    if (!isRecord(nested)) {
      return nested;
    }
    return Object.fromEntries(Object.entries(nested).sort(byKey));
  });
}

/** Lowercase hex SHA-256 of the canonical JSON, the form the `content_hash` CHECKs accept. */
function contentHash(value: object): string {
  return createHash(HASH_ALGORITHM)
    .update(canonicalJson(value))
    .digest(HASH_ENCODING);
}

export { canonicalJson, contentHash };
