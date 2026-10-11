import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  DECISION_HASH,
  DECISION_ID,
  DISPATCH_HASH,
  insertDecisionRecordChain,
  MISMATCHED_HASH,
  RECORDED_AT,
  REPLACEMENT_DISPATCH_ID,
  SECOND_SEEDED_EMPLOYEE_ID,
  SEEDED_EMPLOYEE_ID,
  SEND_BY,
} from "./decision-records.fixtures";
import {
  decisions,
  humanInputs,
  notificationDispatches,
  recommendations,
} from "./schema";
import { createTestDatabase } from "./testing";

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

it("rejects a dispatch whose decision hash differs from the decision's content hash", async () => {
  const store = await createTestDatabase();
  try {
    await insertDecisionRecordChain(store.db);

    await expect(
      store.db
        .insert(notificationDispatches)
        .values({
          decisionId: DECISION_ID,
          decisionHash: MISMATCHED_HASH,
          employeeId: SECOND_SEEDED_EMPLOYEE_ID,
          channel: "email",
          sendBy: SEND_BY,
          recordedAt: RECORDED_AT,
          contentHash: DISPATCH_HASH,
        })
        .execute(),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining(
          "notification_dispatches must copy the referenced decision's content hash",
        ),
      },
    });
  } finally {
    store.close();
  }
});
