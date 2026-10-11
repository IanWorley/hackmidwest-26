import type {
  decisions,
  humanInputs,
  notificationDispatches,
} from "@hackmidwest/db";
import { expect, it } from "vitest";
import { decisionHash, dispatchHash } from "./decision-store";

const NOT_IN_PREIMAGE = "not part of its own preimage";
const RECOMMENDATION_HASH =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DECISION_HASH =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const STORED_DECISION = {
  id: 3,
  contentHash: NOT_IN_PREIMAGE,
  recommendationId: 1,
  recommendationHash: RECOMMENDATION_HASH,
  facilityId: 1,
  action: "override",
  chosenPosture: "full_closure",
  decidedById: 1,
  decidedByName: "Dana Whitfield",
  decidedByRole: "County Executive Director",
  decidedAt: "2026-01-14T09:30:00.000Z",
  identityVerified: false,
  reasonCategory: "road_reports",
  reasonText: "County reports the highway closed.",
  recheckAt: null,
  supersedesDecisionId: null,
} as const satisfies typeof decisions.$inferSelect;

const STORED_INPUT = {
  id: 9,
  decisionId: 3,
  reportedBy: "Night shift supervisor",
  reportedAt: "2026-01-14T09:15:00.000Z",
  text: "The north lot has not been plowed.",
} as const satisfies typeof humanInputs.$inferSelect;

const STORED_DISPATCH = {
  id: 4,
  contentHash: NOT_IN_PREIMAGE,
  decisionId: 3,
  decisionHash: DECISION_HASH,
  employeeId: 1,
  channel: "email",
  sendBy: "2026-01-14T11:30:00.000Z",
  recordedAt: "2026-01-14T10:00:00.000Z",
} as const satisfies typeof notificationDispatches.$inferSelect;

/** SHA-256 of the content columns plus each input's reportedBy, reportedAt, and text as canonical JSON, computed outside the codebase with Python's hashlib. */
const STORED_DECISION_DIGEST =
  "649ab822fee8828f80e50ed601c3027073aa3bd72f0cc62c5d3de3af529846db";

/** SHA-256 of the dispatch's content columns as canonical JSON, computed the same way. */
const STORED_DISPATCH_DIGEST =
  "d3f39271e10d338652466fd6aa4735065a54e99382ee33d021917b0b2d76f6ee";

it("decisionHash digests a stored decision and its stored inputs to a fixed SHA-256, so renaming a column cannot silently change hashes", () => {
  expect(
    decisionHash({ ...STORED_DECISION, humanInputs: [STORED_INPUT] }),
  ).toBe(STORED_DECISION_DIGEST);
});

it("dispatchHash digests a stored dispatch's content columns to a fixed SHA-256", () => {
  expect(dispatchHash(STORED_DISPATCH)).toBe(STORED_DISPATCH_DIGEST);
});
