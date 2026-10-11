import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  DANA_WHITFIELD_ID,
  DECIDE_PATH,
  HISTORY_PATH,
  MARCUS_OYELARAN_ID,
  withDecisionApp,
} from "./decision-test-app";
import { CLOCK, EVALUATE_PATH } from "./recommendation-test-app";

const AFTER_DECIDE_BY = "2026-01-14T11:30:00.000Z";

interface HistoryEntry {
  readonly recommendationId: number;
  readonly action: string;
  readonly chosenPosture: string | null;
  readonly decidedById: number;
  readonly decidedByName: string;
  readonly decidedAt: string;
}

function entries(history: readonly HistoryEntry[]): HistoryEntry[] {
  return history.map(
    ({
      recommendationId,
      action,
      chosenPosture,
      decidedById,
      decidedByName,
      decidedAt,
    }) => ({
      recommendationId,
      action,
      chosenPosture,
      decidedById,
      decidedByName,
      decidedAt,
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(CLOCK) });
});

afterEach(() => {
  vi.useRealTimers();
});

it(`POST ${EVALUATE_PATH} after a missed decideBy records no_decision on the prior recommendation, naming the backup decision maker`, async () => {
  await withDecisionApp(async ({ evaluate, get }) => {
    await evaluate();
    vi.setSystemTime(new Date(AFTER_DECIDE_BY));

    await evaluate();

    expect(entries(await (await get(HISTORY_PATH)).json())).toEqual([
      {
        recommendationId: 1,
        action: "no_decision",
        chosenPosture: null,
        decidedById: MARCUS_OYELARAN_ID,
        decidedByName: "Marcus Oyelaran",
        decidedAt: AFTER_DECIDE_BY,
      },
    ]);
  });
});

it(`POST ${EVALUATE_PATH} after decideBy records nothing more when the prior recommendation was decided`, async () => {
  await withDecisionApp(async ({ evaluate, get, post }) => {
    await evaluate();
    await post(DECIDE_PATH, {
      action: "accept",
      decidedById: DANA_WHITFIELD_ID,
    });
    vi.setSystemTime(new Date(AFTER_DECIDE_BY));

    await evaluate();

    expect(entries(await (await get(HISTORY_PATH)).json())).toEqual([
      {
        recommendationId: 1,
        action: "accept",
        chosenPosture: "full_closure",
        decidedById: DANA_WHITFIELD_ID,
        decidedByName: "Dana Whitfield",
        decidedAt: CLOCK,
      },
    ]);
  });
});

it(`POST ${EVALUATE_PATH} before decideBy records no decision for the prior recommendation`, async () => {
  await withDecisionApp(async ({ evaluate, get }) => {
    await evaluate();

    await evaluate();

    expect(await (await get(HISTORY_PATH)).json()).toEqual([]);
  });
});
