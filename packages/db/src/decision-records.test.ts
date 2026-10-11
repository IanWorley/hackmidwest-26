import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import type { Database } from "./client";
import {
  decisions,
  humanInputs,
  notificationDispatches,
  recommendations,
} from "./schema";
import { seedDemoFacilities } from "./seed";
import { createTestDatabase } from "./testing";

const SEEDED_FACILITY_ID = 1;
const SEEDED_DECISION_MAKER_ID = 1;
const SEEDED_EMPLOYEE_ID = 1;
const RECOMMENDATION_ID = 1;
const DECISION_ID = 1;
const DISPATCH_ID = 1;
const REPLACEMENT_DISPATCH_ID = 2;
const RECOMMENDATION_HASH =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DECISION_HASH =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const DISPATCH_HASH =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const AS_OF = "2026-10-02T09:55:00.000Z";
const EVALUATED_AT = "2026-10-02T10:00:00.000Z";
const DECIDED_AT = "2026-10-02T10:30:00.000Z";
const DECIDE_BY = "2026-10-02T11:00:00.000Z";
// DECIDED_AT is 30 minutes before DECIDE_BY.
const MINUTES_BEFORE_DECIDE_BY = 30;
const SEND_BY = "2026-10-02T11:30:00.000Z";
const RECORDED_AT = "2026-10-02T10:35:00.000Z";

async function insertDecisionRecordChain(db: Database): Promise<void> {
  await seedDemoFacilities(db);
  await db.insert(recommendations).values({
    id: RECOMMENDATION_ID,
    facilityId: SEEDED_FACILITY_ID,
    evaluatedAt: EVALUATED_AT,
    asOf: AS_OF,
    posture: "delayed_arrival",
    confidence: "medium",
    decideBy: DECIDE_BY,
    snapshot: { posture: "delayed_arrival" },
    contentHash: RECOMMENDATION_HASH,
  });
  await db.insert(decisions).values({
    id: DECISION_ID,
    recommendationId: RECOMMENDATION_ID,
    recommendationHash: RECOMMENDATION_HASH,
    facilityId: SEEDED_FACILITY_ID,
    action: "accept",
    chosenPosture: "delayed_arrival",
    decidedById: SEEDED_DECISION_MAKER_ID,
    decidedAt: DECIDED_AT,
    minutesBeforeDecideBy: MINUTES_BEFORE_DECIDE_BY,
    identityVerified: false,
    contentHash: DECISION_HASH,
  });
  await db.insert(notificationDispatches).values({
    id: DISPATCH_ID,
    decisionId: DECISION_ID,
    decisionHash: DECISION_HASH,
    employeeId: SEEDED_EMPLOYEE_ID,
    channel: "email",
    sendBy: SEND_BY,
    recordedAt: RECORDED_AT,
    contentHash: DISPATCH_HASH,
  });
  await db.insert(humanInputs).values({
    decisionId: DECISION_ID,
    reportedBy: "Night shift supervisor",
    reportedAt: RECORDED_AT,
    text: "The north lot has not been plowed.",
  });
}

const ADD_ONLY_TABLES = [
  {
    name: "recommendations",
    table: recommendations,
    updateMessage:
      "recommendations is add-only: record a newer recommendation instead of updating one",
    deleteMessage:
      "recommendations is add-only: recommendations cannot be deleted",
  },
  {
    name: "decisions",
    table: decisions,
    updateMessage:
      "decisions is add-only: record a superseding decision instead of updating one",
    deleteMessage: "decisions is add-only: decisions cannot be deleted",
  },
  {
    name: "notification_dispatches",
    table: notificationDispatches,
    updateMessage:
      "notification_dispatches is add-only: record a dispatch once instead of updating it",
    deleteMessage:
      "notification_dispatches is add-only: dispatches cannot be deleted",
  },
  {
    name: "human_inputs",
    table: humanInputs,
    updateMessage:
      "human_inputs is add-only: record a newer input instead of updating one",
    deleteMessage: "human_inputs is add-only: inputs cannot be deleted",
  },
];

it.each(ADD_ONLY_TABLES)(
  "rejects updating a recorded $name row",
  async ({ table, updateMessage }) => {
    const store = await createTestDatabase();
    try {
      await insertDecisionRecordChain(store.db);

      await expect(
        store.db.run(sql`update ${table} set id = id`),
      ).rejects.toMatchObject({
        cause: { message: expect.stringContaining(updateMessage) },
      });
    } finally {
      store.close();
    }
  },
);

it.each(ADD_ONLY_TABLES)(
  "rejects deleting a recorded $name row",
  async ({ table, deleteMessage }) => {
    const store = await createTestDatabase();
    try {
      await insertDecisionRecordChain(store.db);

      await expect(
        store.db.run(sql`delete from ${table}`),
      ).rejects.toMatchObject({
        cause: { message: expect.stringContaining(deleteMessage) },
      });
    } finally {
      store.close();
    }
  },
);

it("rejects an override decision without a reason", async () => {
  const store = await createTestDatabase();
  try {
    await insertDecisionRecordChain(store.db);

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

it("rejects an INSERT OR REPLACE that dispatches the same decision to the same recipient again", async () => {
  const store = await createTestDatabase();
  try {
    await insertDecisionRecordChain(store.db);

    await expect(
      store.db.run(
        sql`insert or replace into notification_dispatches (id, decision_id, decision_hash, employee_id, channel, send_by, recorded_at, content_hash) values (${REPLACEMENT_DISPATCH_ID}, ${DECISION_ID}, ${DECISION_HASH}, ${SEEDED_EMPLOYEE_ID}, 'sms', ${SEND_BY}, ${RECORDED_AT}, ${DISPATCH_HASH})`,
      ),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining(
          "notification_dispatches is add-only: this decision was already dispatched to this recipient",
        ),
      },
    });
  } finally {
    store.close();
  }
});
