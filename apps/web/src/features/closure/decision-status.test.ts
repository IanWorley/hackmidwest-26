import { expect, it } from "vitest";
import type { EvaluatedStanding } from "@/features/map/load-map";
import { DECISION_STATUSES, effectivePosture } from "./decision-status";

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
    },
  };
  expect(effectivePosture(standing)).toBe("full_closure");
});

it("labels each decision action and keeps the deadline live only for a deferral", () => {
  expect(Object.entries(DECISION_STATUSES)).toEqual([
    ["accept", { label: "Accepted", awaitsDecision: false }],
    ["override", { label: "Overridden", awaitsDecision: false }],
    ["defer", { label: "Deferred", awaitsDecision: true }],
    ["no_decision", { label: "Missed decision", awaitsDecision: false }],
  ]);
});
