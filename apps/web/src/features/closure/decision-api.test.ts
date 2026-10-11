import { afterEach, expect, it, vi } from "vitest";
import { type DecisionRequest, decide } from "./decision-api";

const RECOMMENDATION_ID = 5;
const ACCEPT: DecisionRequest = { action: "accept", decidedById: 1 };
const HTTP_CONFLICT = 409;
const HTTP_UNPROCESSABLE = 422;

function respondWith(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json(body, { status }))),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it.each([
  [
    { conflict: "preview_recommendation", latestRecommendationId: 9 },
    "previewRecommendation",
  ],
  [
    { conflict: "newer_recommendation", latestRecommendationId: 9 },
    "newerRecommendation",
  ],
  [{ conflict: "newer_decision", latestDecisionId: 3 }, "decisionChanged"],
])("a 409 with %j reads as %s", async (body, conflict) => {
  respondWith(HTTP_CONFLICT, body);

  expect(await decide(RECOMMENDATION_ID, ACCEPT)).toEqual({
    kind: "conflict",
    conflict,
  });
});

it.each([
  ["/decidedById", "recordedBy"],
  ["/reason/text", "reasonText"],
  ["/reason", "reasonText"],
  ["/recheckAt", "recheckIn"],
  ["/scope/buildingId", "scope"],
  ["/supersedesDecisionId", "form"],
])("a 422 on %s flags the %s control", async (property, field) => {
  respondWith(HTTP_UNPROCESSABLE, {
    type: "validation",
    on: "body",
    property,
    message: "Expected a valid value",
  });

  expect(await decide(RECOMMENDATION_ID, ACCEPT)).toEqual({
    kind: "invalid",
    field,
  });
});
