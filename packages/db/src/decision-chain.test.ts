import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  DECIDED_AT,
  DECIDER_NAME,
  DECIDER_ROLE,
  DECISION_HASH,
  DECISION_ID,
  insertDecisionRecordChain,
  MINUTES_BEFORE_DECIDE_BY,
  MISMATCHED_HASH,
  RECOMMENDATION,
  RECOMMENDATION_HASH,
  RECOMMENDATION_ID,
  REPLACEMENT_DECISION_ID,
  ROOT_DECISION,
  SEEDED_DECISION_MAKER_ID,
  SEEDED_FACILITY_ID,
} from "./decision-records.fixtures";
import { decisions, recommendations } from "./schema";
import { seedDemoFacilities } from "./seed";
import { createTestDatabase } from "./testing";

it("rejects an override decision without a reason", async () => {
  const store = await createTestDatabase();
  try {
    await seedDemoFacilities(store.db);
    await store.db.insert(recommendations).values(RECOMMENDATION);

    await expect(
      store.db
        .insert(decisions)
        .values({
          recommendationId: RECOMMENDATION_ID,
          recommendationHash: RECOMMENDATION_HASH,
          facilityId: SEEDED_FACILITY_ID,
          action: "override",
          chosenPosture: "full_closure",
          decidedById: SEEDED_DECISION_MAKER_ID,
          decidedByName: DECIDER_NAME,
          decidedByRole: DECIDER_ROLE,
          decidedAt: DECIDED_AT,
          minutesBeforeDecideBy: MINUTES_BEFORE_DECIDE_BY,
          identityVerified: false,
          contentHash: DECISION_HASH,
        })
        .execute(),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining(
          "CHECK constraint failed: decisions_override_and_defer_require_reason",
        ),
      },
    });
  } finally {
    store.close();
  }
});

it("rejects an INSERT OR REPLACE that adds a second root decision for a recommendation", async () => {
  const store = await createTestDatabase();
  try {
    await insertDecisionRecordChain(store.db);

    await expect(
      store.db.run(
        sql`insert or replace into decisions (id, recommendation_id, recommendation_hash, facility_id, action, chosen_posture, decided_by_id, decided_by_name, decided_by_role, decided_at, minutes_before_decide_by, identity_verified, content_hash) values (${REPLACEMENT_DECISION_ID}, ${RECOMMENDATION_ID}, ${RECOMMENDATION_HASH}, ${SEEDED_FACILITY_ID}, 'accept', 'delayed_arrival', ${SEEDED_DECISION_MAKER_ID}, ${DECIDER_NAME}, ${DECIDER_ROLE}, ${DECIDED_AT}, ${MINUTES_BEFORE_DECIDE_BY}, 0, ${DECISION_HASH})`,
      ),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining(
          "decisions is add-only: this recommendation already has a decision; supersede it instead",
        ),
      },
    });
  } finally {
    store.close();
  }
});

it("rejects a second decision that supersedes an already superseded decision", async () => {
  const store = await createTestDatabase();
  try {
    await insertDecisionRecordChain(store.db);
    const correction = {
      recommendationId: RECOMMENDATION_ID,
      recommendationHash: RECOMMENDATION_HASH,
      facilityId: SEEDED_FACILITY_ID,
      action: "override",
      chosenPosture: "full_closure",
      decidedById: SEEDED_DECISION_MAKER_ID,
      decidedByName: DECIDER_NAME,
      decidedByRole: DECIDER_ROLE,
      decidedAt: DECIDED_AT,
      minutesBeforeDecideBy: MINUTES_BEFORE_DECIDE_BY,
      identityVerified: false,
      reasonCategory: "road_reports",
      reasonText: "County reports the highway closed.",
      supersedesDecisionId: DECISION_ID,
      contentHash: DECISION_HASH,
    } as const;
    await store.db.insert(decisions).values(correction);

    await expect(
      store.db.insert(decisions).values(correction).execute(),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining(
          "decisions is add-only: this decision is already superseded; supersede the newest decision instead",
        ),
      },
    });
  } finally {
    store.close();
  }
});

it("rejects accepting a posture other than the recommended one", async () => {
  const store = await createTestDatabase();
  try {
    await seedDemoFacilities(store.db);
    await store.db.insert(recommendations).values(RECOMMENDATION);

    await expect(
      store.db
        .insert(decisions)
        .values({ ...ROOT_DECISION, chosenPosture: "full_closure" })
        .execute(),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining(
          "decisions must accept the recommended posture or override it with a different one",
        ),
      },
    });
  } finally {
    store.close();
  }
});

it("rejects a decision whose recommendation hash differs from the recommendation's content hash", async () => {
  const store = await createTestDatabase();
  try {
    await seedDemoFacilities(store.db);
    await store.db.insert(recommendations).values(RECOMMENDATION);

    await expect(
      store.db
        .insert(decisions)
        .values({ ...ROOT_DECISION, recommendationHash: MISMATCHED_HASH })
        .execute(),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining(
          "decisions must copy the referenced recommendation's facility and content hash",
        ),
      },
    });
  } finally {
    store.close();
  }
});
