import type {
  decisions,
  notificationDispatches,
  recommendations,
} from "@hackmidwest/db";
import {
  CHAIN_BREAK_REASONS,
  type ChainLink,
  type ContentHash,
  isContentHash,
  type JsonValue,
  verifyChain,
} from "./records";

const CHAIN_RECORDS = [
  "recommendation",
  "decision",
  "notification_dispatch",
] as const;
type ChainRecord = (typeof CHAIN_RECORDS)[number];

/** A hash break, or a decision that supersedes one the chain no longer holds. */
const DECISION_CHAIN_BREAK_REASONS = [
  ...CHAIN_BREAK_REASONS,
  "missing_predecessor",
] as const;
type DecisionChainBreakReason = (typeof DECISION_CHAIN_BREAK_REASONS)[number];

type RecommendationRow = typeof recommendations.$inferSelect;
type DecisionRow = typeof decisions.$inferSelect;
type DispatchRow = typeof notificationDispatches.$inferSelect;

/** What a record's content hash covers: every column except its own id and hash. */
type RecordContent<Row> = Omit<Row, "id" | "contentHash">;

/** One recommendation, every decision on it, and every dispatch of those decisions. */
interface DecisionChain {
  readonly recommendation: RecommendationRow;
  readonly decisions: readonly DecisionRow[];
  readonly dispatches: readonly DispatchRow[];
}

interface ChainBreak {
  readonly record: ChainRecord;
  readonly id: number;
  readonly reason: DecisionChainBreakReason;
}

interface StoredRecord {
  readonly record: ChainRecord;
  readonly row: { readonly id: number; readonly contentHash: string };
  readonly parentHash: string | null;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value === "object") {
    return value === null || Object.values(value).every(isJsonValue);
  }
  return ["boolean", "number", "string"].includes(typeof value);
}

// A CHECK constraint holds every stored hash to SHA-256 hex, so anything else is a defect, not a break.
function storedHash(stored: string): ContentHash {
  if (!isContentHash(stored)) {
    throw new TypeError(`Stored hash ${stored} is not SHA-256 hex`);
  }
  return stored;
}

function toLink({ row, parentHash }: StoredRecord): ChainLink {
  const { id: _id, contentHash, ...content } = row;
  if (!isJsonValue(content)) {
    throw new TypeError("A stored record holds a value JSON cannot express");
  }
  const link = { content, contentHash: storedHash(contentHash) };
  if (parentHash === null) {
    return { ...link, parentHash: null };
  }
  return { ...link, parentHash: storedHash(parentHash) };
}

function firstBreak(
  path: readonly [StoredRecord, ...StoredRecord[]],
): ChainBreak | undefined {
  const [root, ...rest] = path;
  const verification = verifyChain([toLink(root), ...rest.map(toLink)]);
  if (verification.ok) {
    return undefined;
  }
  const broken = path[verification.index];
  return (
    broken && {
      record: broken.record,
      id: broken.row.id,
      reason: verification.reason,
    }
  );
}

/** Each root-to-leaf path: recommendation, one decision, and that decision's dispatch when it has any. */
function chainPaths({
  recommendation,
  decisions: chain,
  dispatches,
}: DecisionChain): [StoredRecord, ...StoredRecord[]][] {
  const root: StoredRecord = {
    record: "recommendation",
    row: recommendation,
    parentHash: null,
  };
  return chain.flatMap((decision) => {
    const decisionRecord: StoredRecord = {
      record: "decision",
      row: decision,
      parentHash: decision.recommendationHash,
    };
    const leaves = dispatches.filter(
      ({ decisionId }) => decisionId === decision.id,
    );
    if (leaves.length === 0) {
      return [[root, decisionRecord]];
    }
    return leaves.map((dispatch): [StoredRecord, ...StoredRecord[]] => [
      root,
      decisionRecord,
      {
        record: "notification_dispatch",
        row: dispatch,
        parentHash: dispatch.decisionHash,
      },
    ]);
  });
}

/** Each path hashes intact without the decision it supersedes, so its absence is checked by id. */
function missingPredecessors({
  decisions: chain,
}: DecisionChain): ChainBreak[] {
  const ids = new Set(chain.map(({ id }) => id));
  return chain
    .filter(
      ({ supersedesDecisionId }) =>
        supersedesDecisionId !== null && !ids.has(supersedesDecisionId),
    )
    .map(
      ({ id }): ChainBreak => ({
        record: "decision",
        id,
        reason: "missing_predecessor",
      }),
    );
}

/** Where each path first breaks, each record reported once. A break hides any later break on the same path, since what follows it is already untrustworthy. */
function findChainBreaks(chain: DecisionChain): ChainBreak[] {
  const breaks = new Map<string, ChainBreak>();
  for (const path of chainPaths(chain)) {
    const broken = firstBreak(path);
    if (broken !== undefined) {
      breaks.set(`${broken.record}:${broken.id}`, broken);
    }
  }
  for (const missing of missingPredecessors(chain)) {
    const key = `${missing.record}:${missing.id}`;
    if (!breaks.has(key)) {
      breaks.set(key, missing);
    }
  }
  return [...breaks.values()];
}

export type { DecisionChain, RecordContent };
export {
  CHAIN_RECORDS,
  DECISION_CHAIN_BREAK_REASONS,
  findChainBreaks,
  storedHash,
};
