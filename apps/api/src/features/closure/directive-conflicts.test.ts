import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decisionDirectives,
  decisions,
  recommendations,
} from "@hackmidwest/db";
import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { expect, it } from "vitest";
import { HTTP_CONFLICT, HTTP_CREATED } from "../../runtime";
import {
  ACCEPT,
  appRunner,
  BEFORE_DECIDED_AT,
  type Db,
  DECIDED_AT,
  DECIDER_ID,
  DEFER,
  decide,
  FACILITY_ID,
  FIRST_DECISION_ID,
  NEWER_RECOMMENDATION_ID,
  OVERRIDE,
  RECOMMENDATION,
  SECOND_DECISION_ID,
} from "./decision-test-fixtures";
import {
  dispatchReviewed,
  recommend,
  STORM,
} from "./notification-route-test-fixtures";
import { contentHash } from "./records";

const withApp = appRunner(createTestDatabaseWithDemoFacilities);

const DIRECTIVES_PATH = `/api/decisions/${FIRST_DECISION_ID}/directives`;
const ESSENTIAL_REPORT = {
  scope: { kind: "group", group: "essential" },
  directive: "report",
  reason: {
    category: "essential_operations",
    text: "Plant operators keep the boilers running.",
  },
  issuedById: DECIDER_ID,
} as const;
const SAME_DAY_REEVALUATION = {
  ...RECOMMENDATION,
  evaluatedAt: BEFORE_DECIDED_AT,
  asOf: BEFORE_DECIDED_AT,
};
const YESTERDAY = {
  ...RECOMMENDATION,
  evaluatedAt: "2026-10-01T10:00:00.000Z",
  asOf: "2026-10-01T10:00:00.000Z",
  decideBy: "2026-10-01T11:00:00.000Z",
  snapshot: { output: { facilityDate: "2026-10-01" } },
} as const;

async function stageRecommendation(
  db: Db,
  recommendation: typeof RECOMMENDATION,
): Promise<{ id: number; contentHash: string }> {
  const [row] = await db
    .insert(recommendations)
    .values({ ...recommendation, contentHash: contentHash(recommendation) })
    .returning();
  if (row === undefined) {
    throw new Error("The staged recommendation insert returned no row");
  }
  return row;
}

/** Yesterday's accepted decision, written as the decision route would have written it then. */
async function stageYesterdaysDecision(db: Db): Promise<void> {
  const recommendation = await stageRecommendation(db, YESTERDAY);
  const decision = {
    recommendationId: recommendation.id,
    recommendationHash: recommendation.contentHash,
    facilityId: FACILITY_ID,
    action: "accept",
    chosenPosture: YESTERDAY.posture,
    recheckAt: null,
    decidedById: DECIDER_ID,
    decidedByName: "Dana Whitfield",
    decidedByRole: "County Executive Director",
    decidedAt: "2026-10-01T10:30:00.000Z",
    identityVerified: false,
    reasonCategory: null,
    reasonText: null,
    supersedesDecisionId: null,
  } as const;
  await db
    .insert(decisions)
    .values({ ...decision, contentHash: contentHash(decision) });
}

it("refuses a directive on yesterday's decision, naming no current decision", async () => {
  await withApp(async ({ db, request }) => {
    await stageYesterdaysDecision(db);

    const response = await request(DIRECTIVES_PATH, ESSENTIAL_REPORT);

    expect([
      response.status,
      await response.json(),
      await db.select().from(decisionDirectives),
    ]).toEqual([
      HTTP_CONFLICT,
      { conflict: "not_current_decision", currentDecisionId: null },
      [],
    ]);
  });
});

it("refuses a directive on a decision that a newer decision supersedes", async () => {
  await withApp(async ({ db, request }) => {
    await request(decide(), ACCEPT);
    await request(decide(), {
      ...OVERRIDE,
      supersedesDecisionId: FIRST_DECISION_ID,
    });

    const response = await request(DIRECTIVES_PATH, ESSENTIAL_REPORT);

    expect([
      response.status,
      await response.json(),
      await db.select().from(decisionDirectives),
    ]).toEqual([
      HTTP_CONFLICT,
      {
        conflict: "not_current_decision",
        currentDecisionId: SECOND_DECISION_ID,
      },
      [],
    ]);
  });
});

it("refuses a directive on an older same-day chain once the re-evaluation is decided", async () => {
  await withApp(async ({ db, request }) => {
    await request(decide(), ACCEPT);
    await stageRecommendation(db, SAME_DAY_REEVALUATION);
    await request(decide(NEWER_RECOMMENDATION_ID), ACCEPT);

    const response = await request(DIRECTIVES_PATH, ESSENTIAL_REPORT);

    expect([
      response.status,
      await response.json(),
      await db.select().from(decisionDirectives),
    ]).toEqual([
      HTTP_CONFLICT,
      {
        conflict: "not_current_decision",
        currentDecisionId: SECOND_DECISION_ID,
      },
      [],
    ]);
  });
});

it("refuses a directive on a defer, which chose no posture", async () => {
  await withApp(async ({ db, request }) => {
    await request(decide(), DEFER);

    const response = await request(DIRECTIVES_PATH, ESSENTIAL_REPORT);

    expect([
      response.status,
      await response.json(),
      await db.select().from(decisionDirectives),
    ]).toEqual([
      HTTP_CONFLICT,
      { conflict: "no_chosen_posture", currentDecisionId: FIRST_DECISION_ID },
      [],
    ]);
  });
});

it("refuses a directive once the decision's notices were dispatched", async () => {
  await withApp(async ({ db, request }) => {
    await recommend(db, STORM);
    await request(decide(NEWER_RECOMMENDATION_ID), ACCEPT);
    await dispatchReviewed(request);

    const response = await request(DIRECTIVES_PATH, ESSENTIAL_REPORT);

    expect([
      response.status,
      await response.json(),
      await db.select().from(decisionDirectives),
    ]).toEqual([
      HTTP_CONFLICT,
      {
        conflict: "already_dispatched",
        currentDecisionId: FIRST_DECISION_ID,
        recordedAt: DECIDED_AT,
      },
      [],
    ]);
  });
});

it("records a directive on the standing decision after an undecided same-day re-evaluation", async () => {
  await withApp(async ({ db, request }) => {
    await request(decide(), ACCEPT);
    await stageRecommendation(db, SAME_DAY_REEVALUATION);

    const response = await request(DIRECTIVES_PATH, ESSENTIAL_REPORT);

    expect([response.status, (await response.json()).decisionId]).toEqual([
      HTTP_CREATED,
      FIRST_DECISION_ID,
    ]);
  });
});

it("serializes a directive with a racing decision write, so neither fails", async () => {
  const directory = mkdtempSync(join(tmpdir(), "directive-race-"));
  const path = join(directory, "db.sqlite");
  const withFileApp = appRunner(() =>
    createTestDatabaseWithDemoFacilities({ kind: "file", path }),
  );
  try {
    await withFileApp(async ({ db, request }) => {
      await request(decide(), ACCEPT);

      const [directive, decision] = await Promise.all([
        request(DIRECTIVES_PATH, ESSENTIAL_REPORT),
        request(decide(), {
          ...OVERRIDE,
          supersedesDecisionId: FIRST_DECISION_ID,
        }),
      ]);

      const directiveFirst = [HTTP_CREATED, HTTP_CREATED, 1];
      const decisionFirst = [HTTP_CONFLICT, HTTP_CREATED, 0];
      expect([directiveFirst, decisionFirst]).toContainEqual([
        directive.status,
        decision.status,
        (await db.select().from(decisionDirectives)).length,
      ]);
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
