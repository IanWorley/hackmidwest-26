import { expect, it } from "vitest";
import type { EvaluatedStanding } from "@/features/map/load-map";
import { decisionDeadline, effectivePosture } from "./decision-status";

const RECHECK_AT = "2026-10-11T12:45:00.000Z";

const FULL_CLOSURE_RECOMMENDATION: EvaluatedStanding = {
  posture: "full_closure",
  recommendationId: 1,
  decideBy: "2026-10-11T13:00:00.000Z",
  asOf: "2026-10-11T12:00:00.000Z",
  decision: null,
};

it("puts an overriding decision's posture in effect", () => {
  const standing: EvaluatedStanding = {
    ...FULL_CLOSURE_RECOMMENDATION,
    decision: {
      action: "override",
      chosenPosture: "normal",
      decidedAt: "2026-10-11T12:30:00.000Z",
      recheckAt: null,
    },
  };
  expect(effectivePosture(standing)).toBe("normal");
});

it("keeps the recommended posture in effect after a deferral", () => {
  const standing: EvaluatedStanding = {
    ...FULL_CLOSURE_RECOMMENDATION,
    decision: {
      action: "defer",
      chosenPosture: null,
      decidedAt: "2026-10-11T12:30:00.000Z",
      recheckAt: RECHECK_AT,
    },
  };
  expect(effectivePosture(standing)).toBe("full_closure");
});

it("counts down to a deferral's recheck time, and to decideBy without a decision", () => {
  const deferred: EvaluatedStanding = {
    ...FULL_CLOSURE_RECOMMENDATION,
    decision: {
      action: "defer",
      chosenPosture: null,
      decidedAt: "2026-10-11T12:30:00.000Z",
      recheckAt: RECHECK_AT,
    },
  };
  expect([
    decisionDeadline(deferred),
    decisionDeadline(FULL_CLOSURE_RECOMMENDATION),
  ]).toEqual([RECHECK_AT, "2026-10-11T13:00:00.000Z"]);
});
