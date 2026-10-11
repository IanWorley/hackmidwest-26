import { decisionMakers, recommendations } from "@hackmidwest/db";
import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Database } from "../../runtime";
import {
  DANA_WHITFIELD_ID,
  DECIDE_PATH,
  type DecisionTestApp,
  HISTORY_PATH,
  MARCUS_OYELARAN_ID,
  ROAD_REPORTS,
  withDecisionAppOn,
} from "./decision-test-app";
import { recordNoDecision } from "./missed-deadline";
import { CLOCK, EVALUATE_PATH } from "./recommendation-test-app";

const AFTER_DECIDE_BY = "2026-01-14T11:30:00.000Z";
const RECHECK_AT = "2026-01-14T10:15:00.000Z";
const LATER_EVALUATION = "2026-01-14T11:30:00.001Z";
const RENAMED_BACKUP = "Someone Else";

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

function withDecisionApp(
  run: (app: DecisionTestApp) => Promise<void>,
): Promise<void> {
  return withDecisionAppOn(createTestDatabaseWithDemoFacilities, run);
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

it(`POST ${EVALUATE_PATH} after both recheckAt and decideBy passed records no no_decision for a deferred recommendation`, async () => {
  await withDecisionApp(async ({ evaluate, get, post }) => {
    await evaluate();
    await post(DECIDE_PATH, {
      action: "defer",
      recheckAt: RECHECK_AT,
      reason: ROAD_REPORTS,
      decidedById: DANA_WHITFIELD_ID,
    });
    vi.setSystemTime(new Date(AFTER_DECIDE_BY));

    await evaluate();

    expect(entries(await (await get(HISTORY_PATH)).json())).toEqual([
      {
        recommendationId: 1,
        action: "defer",
        chosenPosture: null,
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

async function recordNoDecisionOn(
  { db }: DecisionTestApp,
  decidedAt: string,
  backupName?: string,
): Promise<unknown> {
  const [recommendation] = await db.select().from(recommendations);
  const [backup] = await db
    .select()
    .from(decisionMakers)
    .where(eq(decisionMakers.id, MARCUS_OYELARAN_ID));
  if (recommendation === undefined || backup === undefined) {
    throw new Error("expected a recommendation and the backup decider");
  }
  return Effect.runPromise(
    recordNoDecision(
      recommendation,
      { ...backup, name: backupName ?? backup.name },
      decidedAt,
    ).pipe(
      Effect.match({ onFailure: (error) => error._tag, onSuccess: () => "ok" }),
      Effect.provideService(Database, db),
    ),
  );
}

it("recordNoDecision succeeds and keeps the first row when a concurrent evaluation already recorded the missed deadline", async () => {
  await withDecisionApp(async (app) => {
    await app.evaluate();
    await recordNoDecisionOn(app, AFTER_DECIDE_BY);

    const outcome = await recordNoDecisionOn(app, LATER_EVALUATION);

    expect([
      outcome,
      entries(await (await app.get(HISTORY_PATH)).json()),
    ]).toEqual([
      "ok",
      [
        {
          recommendationId: 1,
          action: "no_decision",
          chosenPosture: null,
          decidedById: MARCUS_OYELARAN_ID,
          decidedByName: "Marcus Oyelaran",
          decidedAt: AFTER_DECIDE_BY,
        },
      ],
    ]);
  });
});

it("recordNoDecision still fails when the insert is rejected and no decision was recorded", async () => {
  await withDecisionApp(async (app) => {
    await app.evaluate();

    const outcome = await recordNoDecisionOn(
      app,
      AFTER_DECIDE_BY,
      RENAMED_BACKUP,
    );

    expect([outcome, await (await app.get(HISTORY_PATH)).json()]).toEqual([
      "DecisionStorageError",
      [],
    ]);
  });
});
