import { POSTURES } from "@hackmidwest/db";
import { firstBy } from "./order";
import type { OpmStatus } from "./timing";
import { parseInstant } from "./zoned-time";

function disruption(
  status: OpmStatus,
): readonly [postureRank: number, withinPosture: number] {
  const rank = POSTURES.indexOf(status.posture);
  switch (status.posture) {
    case "delayed_arrival":
      return [rank, status.delayHours];
    case "early_dismissal":
      return [rank, -parseInstant(status.departAt)];
    case "normal":
    case "unscheduled_telework":
    case "full_closure":
      return [rank, 0];
    default:
      return status satisfies never;
  }
}

/** Most disruptive first: a higher posture, then a longer delay or an earlier departure. */
function byDisruption(left: OpmStatus, right: OpmStatus): number {
  const [leftRank, leftDetail] = disruption(left);
  const [rightRank, rightDetail] = disruption(right);
  return rightRank - leftRank || rightDetail - leftDetail;
}

function sameStatus(left: OpmStatus, right: OpmStatus): boolean {
  return byDisruption(left, right) === 0;
}

/** On a tie the earlier item wins, so callers pass items in a fixed order. */
function mostDisruptive<Item>(
  items: readonly Item[],
  statusOf: (item: Item) => OpmStatus,
): Item | undefined {
  return firstBy(items, (left, right) =>
    byDisruption(statusOf(left), statusOf(right)),
  );
}

export { byDisruption, mostDisruptive, sameStatus };
