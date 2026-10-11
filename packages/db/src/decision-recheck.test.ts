import { expect, it } from "vitest";
import { RECOMMENDATION, ROOT_DECISION } from "./decision-records.fixtures";
import { decisions, recommendations } from "./schema";
import { seedDemoFacilities } from "./seed";
import { createTestDatabase } from "./testing";

const RECHECK_AT = "2026-10-02T10:45:00.000Z";
const DEFER_REASON = {
  reasonCategory: "local_conditions",
  reasonText: "Plows are still out on the county roads.",
} as const;

it.each([
  {
    case: "a deferral without a re-check time",
    action: "defer",
    chosenPosture: null,
    recheckAt: null,
  },
  {
    case: "an accept with a re-check time",
    action: "accept",
    chosenPosture: RECOMMENDATION.posture,
    recheckAt: RECHECK_AT,
  },
] as const)("rejects $case", async ({ action, chosenPosture, recheckAt }) => {
  const store = await createTestDatabase();
  try {
    await seedDemoFacilities(store.db);
    await store.db.insert(recommendations).values(RECOMMENDATION);

    await expect(
      store.db
        .insert(decisions)
        .values({
          ...ROOT_DECISION,
          ...DEFER_REASON,
          action,
          chosenPosture,
          recheckAt,
        })
        .execute(),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining(
          "CHECK constraint failed: decisions_recheck_at",
        ),
      },
    });
  } finally {
    store.close();
  }
});
