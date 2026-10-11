import { afterEach, expect, it, vi } from "vitest";
import {
  type DecisionRequest,
  type DirectiveRequest,
  decide,
  evaluateFacility,
  issueDirective,
} from "./decision-api";

const RECOMMENDATION_ID = 5;
const DECISION_ID = 7;
const FACILITY_ID = 1;
const FACILITY_REPORT: DirectiveRequest = {
  scope: { kind: "facility" },
  directive: "report",
  reason: { category: "other", text: "Stay on site." },
  issuedById: 1,
};
const ACCEPT: DecisionRequest = { action: "accept", decidedById: 1 };
const HTTP_CONFLICT = 409;
const HTTP_UNPROCESSABLE = 422;

function respondWith(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json(body, { status }))),
  );
}

const HTTP_BAD_GATEWAY = 502;

function gatewayAnswersWithText(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response("Bad Gateway", {
          status: HTTP_BAD_GATEWAY,
          headers: { "content-type": "text/plain" },
        }),
      ),
    ),
  );
}

function dropConnection(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
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

it("reads a dropped connection on decide as a failed decision", async () => {
  dropConnection();

  expect(await decide(RECOMMENDATION_ID, ACCEPT)).toEqual({ kind: "failed" });
});

it("reads a dropped connection on re-evaluate as a failed evaluation", async () => {
  dropConnection();

  expect(await evaluateFacility(FACILITY_ID)).toBe(false);
});

it("reads a dropped connection on a directive as a failed directive", async () => {
  dropConnection();

  expect(await issueDirective(DECISION_ID, FACILITY_REPORT)).toEqual({
    kind: "failed",
  });
});

it.each([
  { conflict: "not_current_decision", currentDecisionId: null },
  { conflict: "no_chosen_posture", currentDecisionId: 3 },
])("a directive 409 with %j reads as superseded", async (body) => {
  respondWith(HTTP_CONFLICT, body);

  expect(await issueDirective(DECISION_ID, FACILITY_REPORT)).toEqual({
    kind: "superseded",
  });
});

it("reads a gateway's text answer on decide as a failed decision", async () => {
  gatewayAnswersWithText();

  expect(await decide(RECOMMENDATION_ID, ACCEPT)).toEqual({ kind: "failed" });
});

it("reads a gateway's text answer on a directive as a failed directive", async () => {
  gatewayAnswersWithText();

  expect(await issueDirective(DECISION_ID, FACILITY_REPORT)).toEqual({
    kind: "failed",
  });
});
