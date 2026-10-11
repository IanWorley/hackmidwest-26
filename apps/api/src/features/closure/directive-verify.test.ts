import { createTestDatabaseWithDemoFacilities } from "@hackmidwest/db/testing";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HTTP_OK } from "../../runtime";
import type { DecisionTestApp } from "./decision-test-app";
import {
  ESSENTIAL_REPORT,
  FIRST_DIRECTIVES_PATH,
  withDecidedAppOn,
} from "./directive-test-app";
import { CLOCK } from "./recommendation-test-app";

const VERIFY_FIRST_PATH = "/api/decisions/1/verify";

function withDecidedApp(
  run: (app: DecisionTestApp) => Promise<void>,
): Promise<void> {
  return withDecidedAppOn(createTestDatabaseWithDemoFacilities, run);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(CLOCK) });
});

afterEach(() => {
  vi.useRealTimers();
});

it(`GET ${VERIFY_FIRST_PATH} walks each directive and checks it against its decision`, async () => {
  await withDecidedApp(async ({ get, post }) => {
    await post(FIRST_DIRECTIVES_PATH, ESSENTIAL_REPORT);
    await post(FIRST_DIRECTIVES_PATH, {
      ...ESSENTIAL_REPORT,
      scope: { kind: "facility" },
      directive: "telework",
    });

    const response = await get(VERIFY_FIRST_PATH);

    expect([response.status, await response.json()]).toEqual([
      HTTP_OK,
      {
        decisionId: 1,
        ok: true,
        links: [
          { kind: "recommendation", id: 1, ok: true },
          { kind: "decision", id: 1, ok: true },
          { kind: "directive", id: 1, ok: true },
          { kind: "directive", id: 2, ok: true },
        ],
      },
    ]);
  });
});

it(`GET ${VERIFY_FIRST_PATH} flags a directive whose stored content changed after it was hashed`, async () => {
  await withDecidedApp(async ({ db, get, post }) => {
    await post(FIRST_DIRECTIVES_PATH, ESSENTIAL_REPORT);
    await db.run(sql`drop trigger decision_directives_reject_update`);
    await db.run(sql`update decision_directives set directive = 'dismissed'`);

    const { ok, links } = await (await get(VERIFY_FIRST_PATH)).json();

    expect({ ok, links }).toEqual({
      ok: false,
      links: [
        { kind: "recommendation", id: 1, ok: true },
        { kind: "decision", id: 1, ok: true },
        {
          kind: "directive",
          id: 1,
          ok: false,
          faults: ["content_hash_mismatch"],
        },
      ],
    });
  });
});
