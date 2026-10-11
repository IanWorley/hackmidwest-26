import {
  type Database as DrizzleDatabase,
  decisions,
  facilities,
  recommendations,
} from "@hackmidwest/db";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import { LIVE_RECOMMENDATION } from "./recommendation-mode";
import type { Transaction } from "./record-decision";
import { facilityDate } from "./timing";
import { formatDate, type Instant, toIso } from "./zoned-time";

type DecisionRow = typeof decisions.$inferSelect;

/** The columns a caller needs to name, describe, or act on the current decision. */
type CurrentDecisionRow = Pick<
  DecisionRow,
  | "id"
  | "recommendationId"
  | "action"
  | "chosenPosture"
  | "decidedAt"
  | "recheckAt"
>;

/** Plain JSON, so a route can return it as is. */
interface CurrentDecision {
  /** `YYYY-MM-DD`: the facility day `now` falls in, as `formatDate(facilityDate(facility, now))`. */
  readonly facilityDate: string;
  readonly decision: CurrentDecisionRow | null;
}

const SNAPSHOT_FACILITY_DATE = sql<string>`json_extract(${recommendations.snapshot}, '$.output.facilityDate')`;

/**
 * The facility day at `now` and the facility's current decision for it. This is the one definition.
 * The current decision is the newest decision, by `decidedAt` and then `id`, that meets all of:
 *
 * - its recommendation is live (`LIVE_RECOMMENDATION`);
 * - that recommendation's `snapshot.output.facilityDate` equals `formatDate(facilityDate(facility, now))`;
 * - its `decidedAt <= now`.
 *
 * It is not tied to the latest recommendation: a same-day re-evaluation leaves the standing
 * decision current until someone decides on the newer one. `decision` is null when no decision
 * qualifies. The whole result is null for an unknown facility.
 */
async function findCurrentDecision(
  db: DrizzleDatabase | Transaction,
  facilityId: number,
  now: Instant,
): Promise<CurrentDecision | null> {
  const [facility] = await db
    .select({ timezone: facilities.timezone, closesAt: facilities.closesAt })
    .from(facilities)
    .where(eq(facilities.id, facilityId));
  if (facility === undefined) {
    return null;
  }
  const today = formatDate(facilityDate(facility, now));
  const [current] = await db
    .select({
      id: decisions.id,
      recommendationId: decisions.recommendationId,
      action: decisions.action,
      chosenPosture: decisions.chosenPosture,
      decidedAt: decisions.decidedAt,
      recheckAt: decisions.recheckAt,
    })
    .from(decisions)
    .innerJoin(
      recommendations,
      eq(recommendations.id, decisions.recommendationId),
    )
    .where(
      and(
        eq(decisions.facilityId, facilityId),
        LIVE_RECOMMENDATION,
        eq(SNAPSHOT_FACILITY_DATE, today),
        lte(decisions.decidedAt, toIso(now)),
      ),
    )
    .orderBy(desc(decisions.decidedAt), desc(decisions.id))
    .limit(1);
  return { facilityDate: today, decision: current ?? null };
}

export type { CurrentDecision, CurrentDecisionRow };
export { findCurrentDecision };
