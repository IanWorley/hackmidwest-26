import { POSTURES } from "@hackmidwest/db";
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

function isMoreDisruptive(candidate: OpmStatus, current: OpmStatus): boolean {
  const [candidateRank, candidateDetail] = disruption(candidate);
  const [currentRank, currentDetail] = disruption(current);
  return (
    candidateRank > currentRank ||
    (candidateRank === currentRank && candidateDetail > currentDetail)
  );
}

function sameStatus(left: OpmStatus, right: OpmStatus): boolean {
  return !(isMoreDisruptive(left, right) || isMoreDisruptive(right, left));
}

function mostDisruptive<Item>(
  items: readonly Item[],
  statusOf: (item: Item) => OpmStatus,
): Item | undefined {
  const [first, ...rest] = items;
  if (first === undefined) {
    return undefined;
  }
  return rest.reduce((strongest, item) => {
    if (isMoreDisruptive(statusOf(item), statusOf(strongest))) {
      return item;
    }
    return strongest;
  }, first);
}

export { mostDisruptive, sameStatus };
