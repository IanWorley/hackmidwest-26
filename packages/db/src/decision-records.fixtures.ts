import type { Database } from "./client";
import {
  decisions,
  humanInputs,
  notificationDispatches,
  recommendations,
} from "./schema";
import { seedDemoFacilities } from "./seed";

export const SEEDED_FACILITY_ID = 1;
export const SEEDED_DECISION_MAKER_ID = 1;
export const SEEDED_EMPLOYEE_ID = 1;
export const RECOMMENDATION_ID = 1;
export const DECISION_ID = 1;
export const DISPATCH_ID = 1;
export const REPLACEMENT_DISPATCH_ID = 2;
export const RECOMMENDATION_HASH =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const DECISION_HASH =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const DISPATCH_HASH =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
export const AS_OF = "2026-10-02T09:55:00.000Z";
export const EVALUATED_AT = "2026-10-02T10:00:00.000Z";
export const DECIDED_AT = "2026-10-02T10:30:00.000Z";
export const DECIDE_BY = "2026-10-02T11:00:00.000Z";
// DECIDED_AT is 30 minutes before DECIDE_BY.
export const MINUTES_BEFORE_DECIDE_BY = 30;
export const SEND_BY = "2026-10-02T11:30:00.000Z";
export const RECORDED_AT = "2026-10-02T10:35:00.000Z";
export const DECIDER_NAME = "Dana Whitfield";
export const DECIDER_ROLE = "Facility Director";
export const REPLACEMENT_DECISION_ID = 2;
export const SECOND_SEEDED_EMPLOYEE_ID = 2;
export const MISMATCHED_HASH =
  "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

export const RECOMMENDATION = {
  id: RECOMMENDATION_ID,
  facilityId: SEEDED_FACILITY_ID,
  evaluatedAt: EVALUATED_AT,
  asOf: AS_OF,
  posture: "delayed_arrival",
  confidence: "medium",
  decideBy: DECIDE_BY,
  snapshot: { posture: "delayed_arrival" },
  contentHash: RECOMMENDATION_HASH,
} as const;

export const ROOT_DECISION = {
  id: DECISION_ID,
  recommendationId: RECOMMENDATION_ID,
  recommendationHash: RECOMMENDATION_HASH,
  facilityId: SEEDED_FACILITY_ID,
  action: "accept",
  chosenPosture: "delayed_arrival",
  decidedById: SEEDED_DECISION_MAKER_ID,
  decidedByName: DECIDER_NAME,
  decidedByRole: DECIDER_ROLE,
  decidedAt: DECIDED_AT,
  minutesBeforeDecideBy: MINUTES_BEFORE_DECIDE_BY,
  identityVerified: false,
  contentHash: DECISION_HASH,
} as const;

export async function insertDecisionRecordChain(db: Database): Promise<void> {
  await seedDemoFacilities(db);
  await db.insert(recommendations).values(RECOMMENDATION);
  await db.insert(decisions).values(ROOT_DECISION);
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
