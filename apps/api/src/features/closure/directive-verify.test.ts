import { decisionDirectives } from "@hackmidwest/db";
import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import {
  ACCEPT,
  appRunner,
  type Db,
  DECIDER_ID,
  decide,
  FIRST_DECISION_ID,
} from "./decision-test-fixtures";
import { contentHash } from "./records";

const withApp = appRunner(createTestDatabaseWithDemoFacilities);

const VERIFY_PATH = `/api/decisions/${FIRST_DECISION_ID}/verify`;
const DIRECTIVES_PATH = `/api/decisions/${FIRST_DECISION_ID}/directives`;
const OTHER_DECISION_HASH =
  "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const ESSENTIAL_REPORT = {
  scope: { kind: "group", group: "essential" },
  directive: "report",
  reason: {
    category: "essential_operations",
    text: "Plant operators keep the boilers running.",
  },
  issuedById: DECIDER_ID,
} as const;

/** Edits a stored directive the way someone with the database file could, past the add-only trigger. */
async function tamper(db: Db, edit: ReturnType<typeof sql>): Promise<void> {
  await db.run(sql`drop trigger decision_directives_reject_update`);
  await db.run(edit);
}

async function directiveOnFirstDecision(
  request: (path: string, body?: object) => Promise<Response>,
): Promise<void> {
  await request(decide(), ACCEPT);
  await request(DIRECTIVES_PATH, ESSENTIAL_REPORT);
}

it("reports an untouched chain through to its directive as intact", async () => {
  await withApp(async ({ request }) => {
    await directiveOnFirstDecision(request);

    const response = await request(VERIFY_PATH);

    expect(await response.json()).toEqual({
      decisionId: 1,
      intact: true,
      breaks: [],
    });
  });
});

it("reports a directive whose reason text was changed after it was recorded", async () => {
  await withApp(async ({ db, request }) => {
    await directiveOnFirstDecision(request);
    await tamper(
      db,
      sql`update decision_directives set reason_text = 'Everyone stays home.'`,
    );

    const response = await request(VERIFY_PATH);

    expect(await response.json()).toEqual({
      decisionId: 1,
      intact: false,
      breaks: [{ record: "directive", id: 1, reason: "content_altered" }],
    });
  });
});

it("reports a re-hashed directive that no longer names its decision's hash", async () => {
  await withApp(async ({ db, request }) => {
    await directiveOnFirstDecision(request);
    const [stored] = await db.select().from(decisionDirectives);
    if (stored === undefined) {
      throw new Error("The directive was not recorded");
    }
    const { id: _id, contentHash: _hash, ...content } = stored;
    const forged = contentHash({
      ...content,
      decisionHash: OTHER_DECISION_HASH,
    });
    await tamper(
      db,
      sql`update decision_directives set decision_hash = ${OTHER_DECISION_HASH}, content_hash = ${forged}`,
    );

    const response = await request(VERIFY_PATH);

    expect(await response.json()).toEqual({
      decisionId: 1,
      intact: false,
      breaks: [{ record: "directive", id: 1, reason: "broken_link" }],
    });
  });
});
