import { describe, expect, it } from "vitest";
import { evaluatePosture } from "./engine";
import {
  parseSnapshot,
  type RecommendationRow,
  recommendationHash,
} from "./recommendation-store";
import { EXPECTED_INPUT } from "./recommendation-test-app";

const STORED_ROW = {
  id: 7,
  contentHash: "not part of its own preimage",
  facilityId: 1,
  evaluatedAt: "2026-01-14T09:30:00.000Z",
  asOf: "2026-01-14T09:00:00.000Z",
  posture: "full_closure",
  confidence: "high",
  decideBy: "2026-01-14T11:00:00.000Z",
  snapshot: {
    input: { now: "2026-01-14T09:00:00.000Z" },
    output: { rationale: "Winter storm." },
  },
} as const satisfies RecommendationRow;

/** SHA-256 of the row's content columns as canonical JSON, computed outside the codebase with sha256sum. */
const STORED_ROW_DIGEST =
  "042e094b54806b328237f2d6ae09c8568acc2fe33fa4caebdba988542aacd31e";

describe("recommendationHash", () => {
  it("digests a stored row's content columns to a fixed SHA-256, so renaming a column cannot silently change hashes", () => {
    expect(recommendationHash(STORED_ROW)).toBe(STORED_ROW_DIGEST);
  });
});

describe("parseSnapshot", () => {
  it("returns a snapshot of what the engine read and returned", () => {
    const snapshot = {
      input: EXPECTED_INPUT,
      output: evaluatePosture(EXPECTED_INPUT),
    };

    expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(
      snapshot,
    );
  });

  it("rejects a field the schema does not list, naming where it is", () => {
    const output = evaluatePosture(EXPECTED_INPUT);
    const snapshot = {
      input: EXPECTED_INPUT,
      output: { ...output, status: { ...output.status, unlisted: true } },
    };

    expect(() => parseSnapshot(snapshot)).toThrow(
      "Snapshot does not match its schema: /output/status",
    );
  });
});
