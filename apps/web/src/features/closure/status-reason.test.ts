import { expect, it } from "vitest";
import {
  CHICAGO,
  MAIN_OFFICE,
  ONSITE,
  resolvedPerson,
} from "./personnel-test-fixtures";
import type { EffectiveStatus } from "./roster-filter";
import {
  formatFacilityDay,
  formatScheduled,
  formatStatusReason,
} from "./status-reason";

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

const SEED_EVENT = {
  id: 1,
  employeeId: 1,
  status: "working_onsite",
  note: null,
  reportedById: 1,
  reportedAt: "2026-10-01T12:00:00.000Z",
  effectiveFrom: "2026-10-01T12:00:00.000Z",
} as const;
const SCHEDULED_LEAVE = {
  ...SEED_EVENT,
  id: 31,
  status: "not_working",
  note: "Family leave starts Friday.",
  reportedAt: "2026-10-11T08:00:00.000Z",
  effectiveFrom: "2026-10-16T19:00:00.000Z",
} as const;

function averyWith(
  latestEvent: typeof SEED_EVENT | typeof SCHEDULED_LEAVE,
): ReturnType<typeof resolvedPerson> {
  return {
    ...resolvedPerson(1, "Avery Calloway", {
      building: MAIN_OFFICE,
      essential: false,
      effective: ONSITE,
    }),
    baseline: { status: "working_onsite", event: SEED_EVENT },
    latestEvent,
  };
}

it("names a scheduled status that has not started yet", () => {
  expect(formatScheduled(averyWith(SCHEDULED_LEAVE), CHICAGO)).toBe(
    "then not working from Fri, Oct 16, 2026 14:00",
  );
});

it("names nothing when the newest event is the one in effect", () => {
  expect(formatScheduled(averyWith(SEED_EVENT), CHICAGO)).toBeUndefined();
});

it("writes a facility date as its calendar day", () => {
  expect(formatFacilityDay("2026-10-12")).toBe("Mon, Oct 12");
});
