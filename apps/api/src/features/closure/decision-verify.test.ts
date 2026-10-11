import { notificationDispatches } from "@hackmidwest/db";
import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HTTP_NOT_FOUND, HTTP_OK } from "../../runtime";
import { dispatchHash } from "./decision-store";
import {
  DANA_WHITFIELD_ID,
  DECIDE_PATH,
  type DecisionTestApp,
  ROAD_REPORTS,
  withDecisionAppOn,
} from "./decision-test-app";
import { CLOCK, UNKNOWN_ID } from "./recommendation-test-app";

const VERIFY_FIRST_PATH = "/api/decisions/1/verify";
const SEEDED_EMPLOYEE_ID = 1;
const SEND_BY = "2026-01-14T11:30:00.000Z";
const FORGED_HASH =
  "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

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

it(`GET ${VERIFY_FIRST_PATH} reports every link intact from the recommendation through each decision to its dispatches`, async () => {
  await withDecisionApp(async ({ db, evaluate, get, post }) => {
    await evaluate();
    const decision = await (
      await post(DECIDE_PATH, {
        action: "accept",
        decidedById: DANA_WHITFIELD_ID,
        humanInputs: [{ reportedBy: "Night shift", text: "Lot unplowed." }],
      })
    ).json();
    await post(DECIDE_PATH, {
      action: "override",
      posture: "delayed_arrival",
      reason: ROAD_REPORTS,
      supersedesDecisionId: decision.id,
      decidedById: DANA_WHITFIELD_ID,
    });
    const dispatch = {
      decisionId: decision.id,
      decisionHash: decision.contentHash,
      employeeId: SEEDED_EMPLOYEE_ID,
      channel: "email",
      sendBy: SEND_BY,
      recordedAt: CLOCK,
    } as const;
    await db
      .insert(notificationDispatches)
      .values({ ...dispatch, contentHash: dispatchHash(dispatch) });

    const response = await get(VERIFY_FIRST_PATH);

    expect([response.status, await response.json()]).toEqual([
      HTTP_OK,
      {
        decisionId: 1,
        ok: true,
        links: [
          { kind: "recommendation", id: 1, ok: true },
          { kind: "decision", id: 1, ok: true },
          { kind: "decision", id: 2, ok: true },
          { kind: "notification_dispatch", id: 1, ok: true },
        ],
      },
    ]);
  });
});

it(`GET ${VERIFY_FIRST_PATH} flags a decision whose stored content changed after it was hashed`, async () => {
  await withDecisionApp(async ({ db, evaluate, get, post }) => {
    await evaluate();
    await post(DECIDE_PATH, {
      action: "override",
      posture: "delayed_arrival",
      reason: ROAD_REPORTS,
      decidedById: DANA_WHITFIELD_ID,
    });
    await db.run(sql`drop trigger decisions_reject_update`);
    await db.run(sql`update decisions set reason_text = 'Edited later.'`);

    const { ok, links } = await (await get(VERIFY_FIRST_PATH)).json();

    expect({ ok, links }).toEqual({
      ok: false,
      links: [
        { kind: "recommendation", id: 1, ok: true },
        {
          kind: "decision",
          id: 1,
          ok: false,
          faults: ["content_hash_mismatch"],
        },
      ],
    });
  });
});

it(`GET ${VERIFY_FIRST_PATH} flags a decision whose copied hash no longer matches its recommendation`, async () => {
  await withDecisionApp(async ({ db, evaluate, get, post }) => {
    await evaluate();
    await post(DECIDE_PATH, {
      action: "accept",
      decidedById: DANA_WHITFIELD_ID,
    });
    await db.run(sql`drop trigger recommendations_reject_update`);
    await db.run(sql`update recommendations set content_hash = ${FORGED_HASH}`);

    const { ok, links } = await (await get(VERIFY_FIRST_PATH)).json();

    expect({ ok, links }).toEqual({
      ok: false,
      links: [
        {
          kind: "recommendation",
          id: 1,
          ok: false,
          faults: ["content_hash_mismatch"],
        },
        {
          kind: "decision",
          id: 1,
          ok: false,
          faults: ["parent_hash_mismatch"],
        },
      ],
    });
  });
});

it("GET /api/decisions/2/verify flags a decision whose superseded predecessor is gone from the chain", async () => {
  await withDecisionApp(async ({ db, evaluate, get, post }) => {
    await evaluate();
    const first = await (
      await post(DECIDE_PATH, {
        action: "accept",
        decidedById: DANA_WHITFIELD_ID,
      })
    ).json();
    await post(DECIDE_PATH, {
      action: "override",
      posture: "delayed_arrival",
      reason: ROAD_REPORTS,
      supersedesDecisionId: first.id,
      decidedById: DANA_WHITFIELD_ID,
    });
    await db.run(sql`pragma foreign_keys = off`);
    await db.run(sql`drop trigger decisions_reject_delete`);
    await db.run(sql`delete from decisions where id = ${first.id}`);

    const { ok, links } = await (await get("/api/decisions/2/verify")).json();

    expect({ ok, links }).toEqual({
      ok: false,
      links: [
        { kind: "recommendation", id: 1, ok: true },
        {
          kind: "decision",
          id: 2,
          ok: false,
          faults: ["missing_predecessor"],
        },
      ],
    });
  });
});

it(`GET ${VERIFY_FIRST_PATH} flags a dispatch whose copied decision hash was rewritten`, async () => {
  await withDecisionApp(async ({ db, evaluate, get, post }) => {
    await evaluate();
    const decision = await (
      await post(DECIDE_PATH, {
        action: "accept",
        decidedById: DANA_WHITFIELD_ID,
      })
    ).json();
    const dispatch = {
      decisionId: decision.id,
      decisionHash: decision.contentHash,
      employeeId: SEEDED_EMPLOYEE_ID,
      channel: "email",
      sendBy: SEND_BY,
      recordedAt: CLOCK,
    } as const;
    await db
      .insert(notificationDispatches)
      .values({ ...dispatch, contentHash: dispatchHash(dispatch) });
    await db.run(sql`drop trigger notification_dispatches_reject_update`);
    await db.run(
      sql`update notification_dispatches set decision_hash = ${FORGED_HASH}`,
    );

    const { ok, links } = await (await get(VERIFY_FIRST_PATH)).json();

    expect({ ok, links }).toEqual({
      ok: false,
      links: [
        { kind: "recommendation", id: 1, ok: true },
        { kind: "decision", id: 1, ok: true },
        {
          kind: "notification_dispatch",
          id: 1,
          ok: false,
          faults: ["content_hash_mismatch", "parent_hash_mismatch"],
        },
      ],
    });
  });
});

it(`GET ${VERIFY_FIRST_PATH} returns 404 for an unknown decision`, async () => {
  await withDecisionApp(async ({ get }) => {
    const response = await get(`/api/decisions/${UNKNOWN_ID}/verify`);

    expect([response.status, await response.json()]).toEqual([
      HTTP_NOT_FOUND,
      { message: "Decision not found" },
    ]);
  });
});
