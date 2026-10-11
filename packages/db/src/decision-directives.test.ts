import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  DECISION_HASH,
  DECISION_ID,
  DIRECTIVE,
  DIRECTIVE_ID,
  insertDecisionRecordChain,
  MISMATCHED_HASH,
} from "./decision-records.fixtures";
import { decisionDirectives, decisions } from "./schema";
import { createTestDatabase } from "./testing";

const IMPOSSIBLE_INSTANT = "2026-02-30T13:00:00.000Z";
const EFFECTIVE_AT = "2026-10-02T17:30:00.000Z";
const BLANK_REASON = " \t\r\n";
const { id: _id, ...NEW_DIRECTIVE } = DIRECTIVE;

it("links a recorded directive to its decision", async () => {
  const store = await createTestDatabase();
  try {
    await insertDecisionRecordChain(store.db);

    expect(
      await store.db
        .select({
          decisionId: decisions.id,
          decisionHash: decisions.contentHash,
          scope: decisionDirectives.scope,
          directive: decisionDirectives.directive,
        })
        .from(decisionDirectives)
        .innerJoin(decisions, eq(decisionDirectives.decisionId, decisions.id)),
    ).toEqual([
      {
        decisionId: DECISION_ID,
        decisionHash: DECISION_HASH,
        scope: "group:essential",
        directive: "report",
      },
    ]);
  } finally {
    store.close();
  }
});

it.each([
  "building:0",
  "employee:007",
  "employee:9007199254740992",
  "group:managers",
  "facility:1",
  "building:",
])("rejects the scope %j", async (scope) => {
  const store = await createTestDatabase();
  try {
    await insertDecisionRecordChain(store.db);

    await expect(
      store.db.run(
        sql`insert into decision_directives (decision_id, decision_hash, scope, directive, reason_category, reason_text, issued_by_id, issued_at, content_hash) values (${DIRECTIVE.decisionId}, ${DIRECTIVE.decisionHash}, ${scope}, ${DIRECTIVE.directive}, ${DIRECTIVE.reasonCategory}, ${DIRECTIVE.reasonText}, ${DIRECTIVE.issuedById}, ${DIRECTIVE.issuedAt}, ${DIRECTIVE.contentHash})`,
      ),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining(
          "CHECK constraint failed: decision_directives_scope",
        ),
      },
    });
  } finally {
    store.close();
  }
});

it("rejects a directive whose reason is blank", async () => {
  const store = await createTestDatabase();
  try {
    await insertDecisionRecordChain(store.db);

    await expect(
      store.db
        .insert(decisionDirectives)
        .values({ ...NEW_DIRECTIVE, reasonText: BLANK_REASON })
        .execute(),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining(
          "CHECK constraint failed: decision_directives_reason_text_not_blank",
        ),
      },
    });
  } finally {
    store.close();
  }
});

it("rejects a directive effective on a date that does not exist", async () => {
  const store = await createTestDatabase();
  try {
    await insertDecisionRecordChain(store.db);

    await expect(
      store.db
        .insert(decisionDirectives)
        .values({
          ...NEW_DIRECTIVE,
          directive: "dismissed",
          effectiveAt: IMPOSSIBLE_INSTANT,
        })
        .execute(),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining(
          "CHECK constraint failed: decision_directives_effective_at_format",
        ),
      },
    });
  } finally {
    store.close();
  }
});

it("rejects a release time on a directive other than a dismissal", async () => {
  const store = await createTestDatabase();
  try {
    await insertDecisionRecordChain(store.db);

    await expect(
      store.db
        .insert(decisionDirectives)
        .values({ ...NEW_DIRECTIVE, effectiveAt: EFFECTIVE_AT })
        .execute(),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining(
          "CHECK constraint failed: decision_directives_effective_at_dismissed_only",
        ),
      },
    });
  } finally {
    store.close();
  }
});

it("rejects a directive whose decision hash differs from the decision's content hash", async () => {
  const store = await createTestDatabase();
  try {
    await insertDecisionRecordChain(store.db);

    await expect(
      store.db
        .insert(decisionDirectives)
        .values({ ...NEW_DIRECTIVE, decisionHash: MISMATCHED_HASH })
        .execute(),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining(
          "decision_directives must copy the referenced decision's content hash",
        ),
      },
    });
  } finally {
    store.close();
  }
});

it("keeps the recorded directive when an INSERT OR REPLACE reuses its id", async () => {
  const store = await createTestDatabase();
  try {
    await insertDecisionRecordChain(store.db);

    await store.db.run(
      sql`insert or replace into decision_directives (id, decision_id, decision_hash, scope, directive, reason_category, reason_text, issued_by_id, issued_at, content_hash) values (${DIRECTIVE_ID}, ${DIRECTIVE.decisionId}, ${DIRECTIVE.decisionHash}, 'facility', 'dismissed', ${DIRECTIVE.reasonCategory}, ${DIRECTIVE.reasonText}, ${DIRECTIVE.issuedById}, ${DIRECTIVE.issuedAt}, ${DIRECTIVE.contentHash})`,
    );

    expect(
      await store.db
        .select({
          scope: decisionDirectives.scope,
          directive: decisionDirectives.directive,
        })
        .from(decisionDirectives)
        .where(eq(decisionDirectives.id, DIRECTIVE_ID)),
    ).toEqual([{ scope: "group:essential", directive: "report" }]);
  } finally {
    store.close();
  }
});
