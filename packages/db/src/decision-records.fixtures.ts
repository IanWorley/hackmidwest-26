import type { Database } from "./client";
import {
  decisionDirectives,
  decisions,
  humanInputs,
  notificationDispatches,
  recommendations,
} from "./schema";
import { seedDemoFacilities } from "./seed";

export const SEEDED_FACILITY_ID = 1;
export const SECOND_SEEDED_FACILITY_ID = 2;
export const SEEDED_DECISION_MAKER_ID = 1;
export const SEEDED_EMPLOYEE_ID = 1;
export const RECOMMENDATION_ID = 1;
export const NEWER_RECOMMENDATION_ID = 2;
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
export const RECHECK_AT = "2026-10-02T10:45:00.000Z";
export const SEND_BY = "2026-10-02T11:30:00.000Z";
export const RECORDED_AT = "2026-10-02T10:35:00.000Z";
export const DECIDER_NAME = "Dana Whitfield";
export const DECIDER_ROLE = "County Executive Director";
export const REPLACEMENT_DECISION_ID = 2;
export const SECOND_SEEDED_EMPLOYEE_ID = 2;
export const DIRECTIVE_ID = 1;
export const DIRECTIVE_HASH =
  "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
export const ISSUED_AT = "2026-10-02T10:40:00.000Z";
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
  identityVerified: false,
  contentHash: DECISION_HASH,
} as const;

export const CORRECTION = {
  recommendationId: RECOMMENDATION_ID,
  recommendationHash: RECOMMENDATION_HASH,
  facilityId: SEEDED_FACILITY_ID,
  action: "override",
  chosenPosture: "full_closure",
  decidedById: SEEDED_DECISION_MAKER_ID,
  decidedByName: DECIDER_NAME,
  decidedByRole: DECIDER_ROLE,
  decidedAt: DECIDED_AT,
  identityVerified: false,
  reasonCategory: "road_reports",
  reasonText: "County reports the highway closed.",
  supersedesDecisionId: DECISION_ID,
  contentHash: DECISION_HASH,
} as const;

export const DEFERRAL = {
  recommendationId: RECOMMENDATION_ID,
  recommendationHash: RECOMMENDATION_HASH,
  facilityId: SEEDED_FACILITY_ID,
  action: "defer",
  recheckAt: RECHECK_AT,
  decidedById: SEEDED_DECISION_MAKER_ID,
  decidedByName: DECIDER_NAME,
  decidedByRole: DECIDER_ROLE,
  decidedAt: DECIDED_AT,
  identityVerified: false,
  reasonCategory: "local_conditions",
  reasonText: "Waiting on the 10:30 road crew report.",
  contentHash: DECISION_HASH,
} as const;

export const DIRECTIVE = {
  id: DIRECTIVE_ID,
  decisionId: DECISION_ID,
  decisionHash: DECISION_HASH,
  scope: "group:essential",
  directive: "report",
  effectiveAt: null,
  reasonCategory: "essential_operations",
  reasonText: "Plant operators keep the boilers running.",
  issuedById: SEEDED_DECISION_MAKER_ID,
  issuedAt: ISSUED_AT,
  contentHash: DIRECTIVE_HASH,
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
  await db.insert(decisionDirectives).values(DIRECTIVE);
}
