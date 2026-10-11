import { expect, it } from "vitest";
import {
  type RecommendationRow,
  recommendationHash,
} from "./recommendation-store";

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
  // biome-ignore lint/security/noSecrets: a SHA-256 test vector, not a credential.
  "042e094b54806b328237f2d6ae09c8568acc2fe33fa4caebdba988542aacd31e";

it("recommendationHash digests a stored row's content columns to a fixed SHA-256, so renaming a column cannot silently change hashes", () => {
  expect(recommendationHash(STORED_ROW)).toBe(STORED_ROW_DIGEST);
});
