import type { DatabaseStore } from "@hackmidwest/db/connection";
import {
  DANA_WHITFIELD_ID,
  DECIDE_PATH,
  type DecisionTestApp,
  withDecisionAppOn,
} from "./decision-test-app";

const FIRST_DIRECTIVES_PATH = "/api/decisions/1/directives";
const PLANT_OPERATORS = {
  category: "essential_operations",
  text: "Plant operators keep the boilers running.",
} as const;

const ESSENTIAL_REPORT = {
  scope: { kind: "group", group: "essential" },
  directive: "report",
  reason: PLANT_OPERATORS,
  issuedById: DANA_WHITFIELD_ID,
} as const;

/** The storm app with decision 1 accepted on the first recommendation, ready for directives. */
function withDecidedAppOn(
  openStore: () => Promise<DatabaseStore>,
  run: (app: DecisionTestApp) => Promise<void>,
): Promise<void> {
  return withDecisionAppOn(openStore, async (app) => {
    await app.evaluate();
    await app.post(DECIDE_PATH, {
      action: "accept",
      decidedById: DANA_WHITFIELD_ID,
    });
    await run(app);
  });
}

export {
  ESSENTIAL_REPORT,
  FIRST_DIRECTIVES_PATH,
  PLANT_OPERATORS,
  withDecidedAppOn,
};
