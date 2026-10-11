import { decisions, recommendations } from "@hackmidwest/db";
import type { DatabaseStore } from "@hackmidwest/db/connection";
import { asc } from "drizzle-orm";
import { type Clock, Effect } from "effect";
import { createApp } from "../../app";
import { makeNwpsClient } from "../../clients/nwps";
import { makeNwsClient } from "../../clients/nws";
import { makeOpenMeteoClient } from "../../clients/open-meteo";
import { createApiRuntime } from "../../runtime";
import { contentHash, type JsonValue } from "./records";

type Db = DatabaseStore["db"];
type DecisionRow = typeof decisions.$inferSelect;
type RecommendationContent = Omit<
  typeof recommendations.$inferSelect,
  "id" | "contentHash" | "snapshot"
> & { readonly snapshot: JsonValue };

/** Opens a seeded test database. Test files pass it in, since only they may import the db test fixture. */
type OpenStore = () => Promise<DatabaseStore>;

interface AppContext {
  readonly db: Db;
  /** GET without a body, POST JSON with one. */
  readonly request: (path: string, body?: object) => Promise<Response>;
}

const REQUEST_ORIGIN = "http://api.test";
const WEB_ORIGIN = "http://web.test";
const NANOS_PER_MILLI = 1_000_000n;
const FACILITY_ID = 1;
const UNKNOWN_ID = 999;
const DECIDER_ID = 1;
const BACKUP_ID = 2;
const RECOMMENDATION_ID = 1;
const NEWER_RECOMMENDATION_ID = 2;
const FIRST_DECISION_ID = 1;
const SECOND_DECISION_ID = 2;
const EMPLOYEE_ID = 1;
const DECIDE_BY = "2026-10-02T11:00:00.000Z";
const BEFORE_DECIDED_AT = "2026-10-02T10:15:00.000Z";
const DECIDED_AT = "2026-10-02T10:30:00.000Z";
const MINUTE_AFTER_DECIDED_AT = "2026-10-02T10:31:00.000Z";
const HALF_MINUTE_LATE = "2026-10-02T11:00:30.000Z";
const RECHECK_AT = "2026-10-02T10:45:00.000Z";
const AFTER_DECIDE_BY = "2026-10-02T11:15:00.000Z";
const SHA256_HEX = /^[0-9a-f]{64}$/u;

const RECOMMENDATION: RecommendationContent = {
  facilityId: FACILITY_ID,
  evaluatedAt: "2026-10-02T10:00:00.000Z",
  asOf: "2026-10-02T10:00:00.000Z",
  posture: "delayed_arrival",
  confidence: "medium",
  decideBy: DECIDE_BY,
  snapshot: { posture: "delayed_arrival" },
};
const RECOMMENDATION_HASH = contentHash(RECOMMENDATION);
const ROAD_REPORT = {
  category: "road_reports",
  text: "County reports the highway closed.",
} as const;
const ACCEPT = { action: "accept", decidedById: DECIDER_ID } as const;
const OVERRIDE = {
  action: "override",
  chosenPosture: "full_closure",
  decidedById: DECIDER_ID,
  reason: ROAD_REPORT,
} as const;
const DEFER = {
  action: "defer",
  recheckAt: RECHECK_AT,
  decidedById: DECIDER_ID,
  reason: ROAD_REPORT,
} as const;

function fixedClock(at: string): Clock.Clock {
  const millis = Date.parse(at);
  const nanos = BigInt(millis) * NANOS_PER_MILLI;
  return {
    currentTimeMillisUnsafe: () => millis,
    currentTimeMillis: Effect.succeed(millis),
    currentTimeNanosUnsafe: () => nanos,
    currentTimeNanos: Effect.succeed(nanos),
    monotonicTimeNanosUnsafe: () => nanos,
    monotonicTimeNanos: Effect.succeed(nanos),
    sleep: () => Effect.void,
  };
}

function requestFor(path: string, body: object | undefined): Request {
  const url = new URL(path, REQUEST_ORIGIN);
  if (body === undefined) {
    return new Request(url);
  }
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

type WithApp = (
  run: (context: AppContext) => Promise<void>,
  now?: string,
) => Promise<void>;

/** Runs `run` against a seeded app whose clock reads `now`, holding one recommendation for facility 1. */
function appRunner(openStore: OpenStore): WithApp {
  return (run, now = DECIDED_AT) => withApp(openStore, run, now);
}

async function withApp(
  openStore: OpenStore,
  run: (context: AppContext) => Promise<void>,
  now: string,
): Promise<void> {
  const store = await openStore();
  const runtime = createApiRuntime(
    store.db,
    {
      nws: makeNwsClient({ userAgent: "decisions test, never sent" }),
      openMeteo: makeOpenMeteoClient(),
      nwps: makeNwpsClient(),
    },
    { clock: fixedClock(now) },
  );
  try {
    await store.db
      .insert(recommendations)
      .values({ ...RECOMMENDATION, contentHash: RECOMMENDATION_HASH });
    const app = createApp({
      runRequest: runtime.runRequest,
      webOrigin: WEB_ORIGIN,
    });
    await run({
      db: store.db,
      request: (path, body) => app.handle(requestFor(path, body)),
    });
  } finally {
    try {
      await runtime.dispose();
    } finally {
      store.close();
    }
  }
}

function decide(recommendationId: number = RECOMMENDATION_ID): string {
  return `/api/recommendations/${recommendationId}/decisions`;
}

function storedDecisions(db: Db): Promise<DecisionRow[]> {
  return db.select().from(decisions).orderBy(asc(decisions.id)).all();
}

export type { Db };
export {
  ACCEPT,
  AFTER_DECIDE_BY,
  appRunner,
  BACKUP_ID,
  BEFORE_DECIDED_AT,
  DECIDE_BY,
  DECIDED_AT,
  DECIDER_ID,
  DEFER,
  decide,
  EMPLOYEE_ID,
  FACILITY_ID,
  FIRST_DECISION_ID,
  HALF_MINUTE_LATE,
  MINUTE_AFTER_DECIDED_AT,
  NEWER_RECOMMENDATION_ID,
  OVERRIDE,
  RECHECK_AT,
  RECOMMENDATION,
  RECOMMENDATION_HASH,
  RECOMMENDATION_ID,
  SECOND_DECISION_ID,
  SHA256_HEX,
  storedDecisions,
  UNKNOWN_ID,
};
