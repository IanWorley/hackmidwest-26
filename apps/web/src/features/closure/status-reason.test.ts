import { expect, it } from "vitest";
import { CHICAGO } from "./personnel-test-fixtures";
import type { EffectiveStatus } from "./roster-filter";
import { formatStatusReason } from "./status-reason";

const ESSENTIAL_STAFF_DIRECTIVE = {
  id: 1,
  scope: { kind: "group", group: "essential" },
  directive: "report",
  effectiveAt: null,
  reasonCategory: "operations",
  reasonText: "essential staff remain",
  issuedById: 1,
  issuedAt: "2026-01-14T12:00:00.000Z",
} as const;

const CASES: [EffectiveStatus, string][] = [
  [
    {
      kind: "dismissed",
      release: { at: "2026-01-14T19:30:00.000Z" },
      cause: { source: "posture", posture: "early_dismissal" },
    },
    "dismissed, early dismissal 13:30",
  ],
  [
    {
      kind: "report_required",
      cause: { source: "directive", directive: ESSENTIAL_STAFF_DIRECTIVE },
    },
    "report required, directive: essential staff remain",
  ],
  [
    {
      kind: "teleworking",
      cause: {
        source: "baseline",
        baseline: { status: "teleworking", event: null },
      },
    },
    "teleworking, baseline",
  ],
  [
    {
      kind: "not_working",
      note: "Detailed to the state office",
      cause: { source: "posture", posture: "full_closure" },
    },
    "not working, Detailed to the state office",
  ],
  [
    {
      kind: "not_working",
      note: "Annex heat is out",
      cause: {
        source: "directive",
        directive: {
          ...ESSENTIAL_STAFF_DIRECTIVE,
          scope: { kind: "building", buildingId: 2 },
          directive: "excused",
          reasonText: "Annex heat is out",
        },
      },
    },
    "not working, directive: Annex heat is out",
  ],
];

it.each(CASES)("explains a status as %#: %s", (effective, reason) => {
  expect(formatStatusReason(effective, CHICAGO)).toBe(reason);
});
