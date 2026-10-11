import type { decisionDirectives } from "@hackmidwest/db";
import { expect, it } from "vitest";
import { directiveHash, directiveRecordOf } from "./directive-store";

const DECISION_HASH =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const STORED_DIRECTIVE = {
  id: 5,
  contentHash: "not part of its own preimage",
  decisionId: 3,
  decisionHash: DECISION_HASH,
  scope: "employee:8",
  directive: "dismissed",
  effectiveAt: "2026-01-14T17:30:00.000Z",
  reasonCategory: "road_reports",
  reasonText: "Long commute over an unplowed county road.",
  issuedById: 1,
  issuedAt: "2026-01-14T09:45:00.000Z",
} as const satisfies typeof decisionDirectives.$inferSelect;

const EXTERNAL_DIRECTIVE_DIGEST =
  "7c298e6a87c0ae07ef14c8feb5b861947e033d1d8f8d1dedc4176042565400c9";

it("directiveHash digests a stored directive's content columns to a fixed SHA-256, so renaming a column cannot silently change hashes", () => {
  expect(directiveHash(STORED_DIRECTIVE)).toBe(EXTERNAL_DIRECTIVE_DIGEST);
});

it("directiveRecordOf reads the stored scope text as a typed scope", () => {
  expect(directiveRecordOf(STORED_DIRECTIVE).scope).toEqual({
    kind: "employee",
    employeeId: 8,
  });
});

it("directiveRecordOf refuses a row whose scope the CHECK should have rejected", () => {
  expect(() =>
    directiveRecordOf({ ...STORED_DIRECTIVE, scope: "employee:08" }),
  ).toThrow("decision_directives row 5 has an unreadable scope: employee:08");
});
