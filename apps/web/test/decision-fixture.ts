import type { Decision, Directive } from "../src/features/closure/decision-api";
import { KANSAS_CITY_RECOMMENDATION } from "./recommendation-fixture";

const SHA256_HEX_LENGTH = 64;
/** decidedAt is 08:40Z and the recommendation's decideBy is 10:00Z. */
const MINUTES_BEFORE_DECIDE_BY = 80;

/** A stand-in content hash; the screen shows none, so only its shape matters. */
function hashOf(digit: string): string {
  return digit.repeat(SHA256_HEX_LENGTH);
}

/** Dana Whitfield's accept of KANSAS_CITY_RECOMMENDATION. */
export const KANSAS_CITY_ACCEPT: Decision = {
  id: 1,
  recommendationId: KANSAS_CITY_RECOMMENDATION.id,
  recommendationHash: hashOf("a"),
  facilityId: 1,
  action: "accept",
  chosenPosture: "delayed_arrival",
  recheckAt: null,
  decidedById: 1,
  decidedByName: "Dana Whitfield",
  decidedByRole: "County Executive Director",
  decidedAt: "2026-10-11T08:40:00.000Z",
  identityVerified: false,
  reasonCategory: null,
  reasonText: null,
  supersedesDecisionId: null,
  contentHash: hashOf("b"),
  minutesBeforeDecideBy: MINUTES_BEFORE_DECIDE_BY,
  humanInputs: [],
};

/** A directive on KANSAS_CITY_ACCEPT, issued by the backup, which dismisses the Annex at a set time. */
export const ANNEX_DISMISSAL: Directive = {
  id: 1,
  decisionId: KANSAS_CITY_ACCEPT.id,
  decisionHash: KANSAS_CITY_ACCEPT.contentHash,
  scope: { kind: "building", buildingId: 2 },
  directive: "dismissed",
  effectiveAt: "2026-10-11T16:30:00.000Z",
  reasonCategory: "local_conditions",
  reasonText: "The Annex has no heat.",
  issuedById: 2,
  issuedByName: "Marcus Oyelaran",
  issuedByRole: "State Administrative Officer",
  issuedAt: "2026-10-11T08:45:00.000Z",
  contentHash: hashOf("c"),
};
