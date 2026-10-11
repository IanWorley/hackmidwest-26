import { createHash } from "node:crypto";

const HASH_ALGORITHM = "sha256";
const DIGEST_ENCODING = "hex";
const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/u;

type Ordering = -1 | 0 | 1;

function compareCodeUnits(left: string, right: string): Ordering {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type ContentHash = string & { readonly __brand: "ContentHash" };

export const CHAIN_BREAK_REASONS = ["content_altered", "broken_link"] as const;

export type ChainBreakReason = (typeof CHAIN_BREAK_REASONS)[number];

export interface ChainLink {
  readonly content: JsonValue;
  readonly contentHash: ContentHash;
  readonly parentHash: ContentHash | null;
}

export type ChainVerification =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly index: number;
      readonly reason: ChainBreakReason;
    };

export function isContentHash(value: string): value is ContentHash {
  return CONTENT_HASH_PATTERN.test(value);
}

export function canonicalJson(value: JsonValue): string {
  if (typeof value === "number") {
    // JSON.stringify writes NaN and Infinity as null, so two different
    // snapshots would hash the same.
    if (!Number.isFinite(value)) {
      throw new RangeError("Cannot hash a non-finite number");
    }
    return JSON.stringify(value);
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const members = Object.entries(value)
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`);
  return `{${members.join(",")}}`;
}

export function contentHash(value: JsonValue): ContentHash {
  const digest = createHash(HASH_ALGORITHM)
    .update(canonicalJson(value))
    .digest(DIGEST_ENCODING);
  if (!isContentHash(digest)) {
    throw new TypeError(`Unexpected ${HASH_ALGORITHM} digest ${digest}`);
  }
  return digest;
}

export function verifyChain(
  links: readonly [ChainLink, ...ChainLink[]],
): ChainVerification {
  let expectedParent: ContentHash | null = null;
  for (const [index, link] of links.entries()) {
    if (contentHash(link.content) !== link.contentHash) {
      return { ok: false, index, reason: "content_altered" };
    }
    if (link.parentHash !== expectedParent) {
      return { ok: false, index, reason: "broken_link" };
    }
    expectedParent = link.contentHash;
  }
  return { ok: true };
}
