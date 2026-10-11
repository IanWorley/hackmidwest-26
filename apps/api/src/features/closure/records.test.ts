import { describe, expect, it } from "vitest";
import {
  type ChainLink,
  type ContentHash,
  canonicalJson,
  contentHash,
  type JsonValue,
  verifyChain,
} from "./records";

const NESTED_VALUE = { b: 1, a: { d: [3, 1], c: null } };

function link(content: JsonValue, parentHash: ContentHash | null): ChainLink {
  return { content, contentHash: contentHash(content), parentHash };
}

function buildChain(): [ChainLink, ChainLink, ChainLink] {
  const recommendation = link({ posture: "delayed_arrival" }, null);
  const decision = link(
    { action: "accept", recommendationHash: recommendation.contentHash },
    recommendation.contentHash,
  );
  const dispatch = link(
    { channel: "sms", decisionHash: decision.contentHash },
    decision.contentHash,
  );
  return [recommendation, decision, dispatch];
}

describe("canonicalJson", () => {
  it("sorts object keys recursively and keeps array order", () => {
    expect(canonicalJson(NESTED_VALUE)).toBe(
      '{"a":{"c":null,"d":[3,1]},"b":1}',
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "throws on %s",
    (value) => {
      expect(() => canonicalJson({ reading: value })).toThrow(RangeError);
    },
  );
});

describe("contentHash", () => {
  it("ignores key insertion order", () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
  });

  it("changes when a value changes", () => {
    expect(contentHash({ a: 1, b: 2 })).not.toBe(contentHash({ a: 1, b: 3 }));
  });

  it("is the SHA-256 hex digest of the canonical JSON", () => {
    expect(contentHash(NESTED_VALUE)).toBe(
      "50d5fa153f60083c376fce5c038e7cb7aa89c0345b05bf06a63f32f4a8e97cfa",
    );
  });
});

describe("verifyChain", () => {
  it("accepts an intact chain", () => {
    expect(verifyChain(buildChain())).toEqual({ ok: true });
  });

  it("reports altered content at its index", () => {
    const [recommendation, decision, dispatch] = buildChain();
    const altered = { ...decision, content: { action: "override" } };
    expect(verifyChain([recommendation, altered, dispatch])).toEqual({
      ok: false,
      index: 1,
      reason: "content_altered",
    });
  });

  it("reports a parent hash that does not match the previous link", () => {
    const [recommendation, decision] = buildChain();
    const orphan = link({ channel: "sms" }, recommendation.contentHash);
    expect(verifyChain([recommendation, decision, orphan])).toEqual({
      ok: false,
      index: 2,
      reason: "broken_link",
    });
  });
});
