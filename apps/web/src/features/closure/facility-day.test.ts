import { expect, it } from "vitest";
import { currentDecisionOf } from "./facility-day";

const TODAY = "2026-10-11";
const DECIDED_ID = 5;
const UNDECIDED_ID = 6;

function recommendationFor(
  id: number,
  facilityDate: string,
): { id: number; snapshot: { output: { facilityDate: string } } } {
  return { id, snapshot: { output: { facilityDate } } };
}

it("takes the newest decision on today's recommendation as current", () => {
  const history = [
    { id: 12, recommendationId: 4 },
    { id: 11, recommendationId: DECIDED_ID },
    { id: 10, recommendationId: DECIDED_ID },
  ];

  expect(
    currentDecisionOf(history, recommendationFor(DECIDED_ID, TODAY), TODAY),
  ).toEqual({ id: 11, recommendationId: DECIDED_ID });
  expect(
    currentDecisionOf(history, recommendationFor(UNDECIDED_ID, TODAY), TODAY),
  ).toBeNull();
  expect(currentDecisionOf(history, null, TODAY)).toBeNull();
});

it("carries no decision over from an earlier facility day", () => {
  const history = [{ id: 11, recommendationId: DECIDED_ID }];

  expect(
    currentDecisionOf(
      history,
      recommendationFor(DECIDED_ID, "2026-10-10"),
      TODAY,
    ),
  ).toBeNull();
});
