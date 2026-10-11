import {
  decisionDirectives,
  SUPERSEDED_DECISION_MESSAGE,
} from "@hackmidwest/db";
import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { HTTP_CONFLICT, HTTP_INTERNAL_SERVER_ERROR } from "../../runtime";
import {
  ACCEPT,
  appRunner,
  DECIDER_ID,
  decide,
  FIRST_DECISION_ID,
  OVERRIDE,
  SECOND_DECISION_ID,
} from "./decision-test-fixtures";

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
      { conflict: "newer_decision", latestDecisionId: SECOND_DECISION_ID },
      [],
    ]);
  });
});

it("answers 500, not 409, when another insert failure echoes the superseded message in its reason", async () => {
  await withApp(async ({ db, request }) => {
    await request(decide(), ACCEPT);
    await db.run(
      sql`create trigger directive_insert_fails before insert on decision_directives begin select raise(abort, 'storage failure'); end`,
    );

    const response = await request(DIRECTIVES_PATH, {
      ...ESSENTIAL_REPORT,
      reason: { category: "other", text: SUPERSEDED_DECISION_MESSAGE },
    });

    expect([response.status, await response.json()]).toEqual([
      HTTP_INTERNAL_SERVER_ERROR,
      { message: "Internal server error" },
    ]);
  });
});
