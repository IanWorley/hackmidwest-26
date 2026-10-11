import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recommendations } from "@hackmidwest/db";
import { openDatabase } from "@hackmidwest/db/connection";
import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { DateTime, Effect, Option } from "effect";
import { expect, it } from "vitest";
import { Database } from "../../runtime";
import {
  ACCEPT,
  AFTER_DECIDE_BY,
  appRunner,
  BACKUP_ID,
  type Db,
  DECIDE_BY,
  decide,
  FACILITY_ID,
  FIRST_DECISION_ID,
  RECOMMENDATION,
  RECOMMENDATION_HASH,
  RECOMMENDATION_ID,
  SHA256_HEX,
  storedDecisions,
} from "./decision-test-fixtures";
import { recordMissedDecision } from "./decisions";
import { contentHash } from "./records";

const PREVIEW_ID = 2;
const PREVIEW = { ...RECOMMENDATION, asOf: "2026-10-02T09:00:00.000Z" };

const withApp = appRunner(createTestDatabaseWithDemoFacilities);

function runMissed(
  db: Db,
  now: string,
  recommendationId: number = RECOMMENDATION_ID,
): Promise<Option.Option<number>> {
  return Effect.runPromise(
    recordMissedDecision(recommendationId, DateTime.makeUnsafe(now)).pipe(
      Effect.map(Option.map(({ id }) => id)),
      Effect.provideService(Database, db),
    ),
  );
}

it("records one no_decision row naming the backup, however often it runs", async () => {
  await withApp(async ({ db }) => {
    const first = await runMissed(db, AFTER_DECIDE_BY);
    const second = await runMissed(db, AFTER_DECIDE_BY);

    expect([first, second]).toEqual([
      Option.some(FIRST_DECISION_ID),
      Option.none(),
    ]);
    expect(await storedDecisions(db)).toEqual([
      {
        id: FIRST_DECISION_ID,
        recommendationId: RECOMMENDATION_ID,
        recommendationHash: RECOMMENDATION_HASH,
        facilityId: FACILITY_ID,
        action: "no_decision",
        chosenPosture: null,
        recheckAt: null,
        decidedById: BACKUP_ID,
        decidedByName: "Marcus Oyelaran",
        decidedByRole: "State Administrative Officer",
        decidedAt: AFTER_DECIDE_BY,
        identityVerified: false,
        reasonCategory: null,
        reasonText: null,
        supersedesDecisionId: null,
        contentHash: expect.stringMatching(SHA256_HEX),
      },
    ]);
  });
});

it("writes nothing before decideBy has passed", async () => {
  await withApp(async ({ db }) => {
    const result = await runMissed(db, DECIDE_BY);

    expect([result, await storedDecisions(db)]).toEqual([Option.none(), []]);
  });
});

it("writes nothing when someone already decided", async () => {
  await withApp(async ({ db, request }) => {
    await request(decide(), ACCEPT);

    const result = await runMissed(db, AFTER_DECIDE_BY);

    expect([
      result,
      (await storedDecisions(db)).map(({ action }) => action),
    ]).toEqual([Option.none(), ["accept"]]);
  });
});

it("writes nothing for a preview, which never enters a decision chain", async () => {
  await withApp(async ({ db }) => {
    await db
      .insert(recommendations)
      .values({ ...PREVIEW, contentHash: contentHash(PREVIEW) });

    const result = await runMissed(db, AFTER_DECIDE_BY, PREVIEW_ID);

    expect([result, await storedDecisions(db)]).toEqual([Option.none(), []]);
  });
});

it("records one no_decision row when two connections race, and neither fails", async () => {
  const directory = mkdtempSync(join(tmpdir(), "missed-decision-"));
  const path = join(directory, "db.sqlite");
  const withFileApp = appRunner(() =>
    createTestDatabaseWithDemoFacilities({ kind: "file", path }),
  );
  try {
    await withFileApp(async ({ db }) => {
      const other = openDatabase({ kind: "file", path });
      try {
        const results = await Promise.all([
          runMissed(db, AFTER_DECIDE_BY),
          runMissed(other.db, AFTER_DECIDE_BY),
        ]);

        expect(results).toContainEqual(Option.some(FIRST_DECISION_ID));
        expect(results).toContainEqual(Option.none());
        expect((await storedDecisions(db)).map(({ action }) => action)).toEqual(
          ["no_decision"],
        );
      } finally {
        other.close();
      }
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
