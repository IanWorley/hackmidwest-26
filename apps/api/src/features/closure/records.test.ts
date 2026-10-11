import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, contentHash } from "./records";

const VALUE = { b: { c: [{ e: 4, d: 3 }, 2] }, a: 1 };
const SAME_VALUE_OTHER_KEY_ORDER = { a: 1, b: { c: [{ d: 3, e: 4 }, 2] } };
const CANONICAL_TEXT = '{"a":1,"b":{"c":[{"d":3,"e":4},2]}}';

describe("canonicalJson", () => {
  it("sorts object keys at every depth and keeps array order", () => {
    expect(canonicalJson(VALUE)).toBe(CANONICAL_TEXT);
  });
});

describe("contentHash", () => {
  it("hashes the canonical text, so key order does not change the digest", () => {
    const expected = createHash("sha256").update(CANONICAL_TEXT).digest("hex");

    expect([
      contentHash(VALUE),
      contentHash(SAME_VALUE_OTHER_KEY_ORDER),
    ]).toEqual([expected, expected]);
  });
});
