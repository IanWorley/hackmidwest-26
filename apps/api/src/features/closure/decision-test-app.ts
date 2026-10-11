import type { Database } from "@hackmidwest/db";
import type { DatabaseStore } from "@hackmidwest/db/connection";
import {
  EVALUATE_PATH,
  type TestApp,
  withStormAppOn,
} from "./recommendation-test-app";

const DANA_WHITFIELD_ID = 1;
const MARCUS_OYELARAN_ID = 2;
const FIRST_RECOMMENDATION_ID = 1;
const DECIDE_PATH = `/api/recommendations/${FIRST_RECOMMENDATION_ID}/decisions`;
const HISTORY_PATH = "/api/facilities/1/decisions";
const ROAD_REPORTS = {
  category: "road_reports",
  text: "County reports the highway closed.",
} as const;

interface DecisionTestApp extends TestApp {
  readonly db: Database;
  /** Evaluates the storm facility once, so recommendation 1 exists. */
  readonly evaluate: () => Promise<Response>;
}

/** The storm app on the store `openStore` returns, with its database exposed for reads and tampering. */
async function withDecisionAppOn(
  openStore: () => Promise<DatabaseStore>,
  run: (app: DecisionTestApp) => Promise<void>,
): Promise<void> {
  const store = await openStore();
  await withStormAppOn(
    () => Promise.resolve(store),
    (app) =>
      run({ ...app, db: store.db, evaluate: () => app.post(EVALUATE_PATH) }),
  );
}

export type { DecisionTestApp };
export {
  DANA_WHITFIELD_ID,
  DECIDE_PATH,
  FIRST_RECOMMENDATION_ID,
  HISTORY_PATH,
  MARCUS_OYELARAN_ID,
  ROAD_REPORTS,
  withDecisionAppOn,
};
