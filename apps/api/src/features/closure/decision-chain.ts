import type {
  decisionDirectives,
  decisions,
  notificationDispatches,
  recommendations,
} from "@hackmidwest/db";
import {
  type ChainBreakReason,
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
  "directive",
] as const;
type ChainRecord = (typeof CHAIN_RECORDS)[number];

type RecommendationRow = typeof recommendations.$inferSelect;
type DecisionRow = typeof decisions.$inferSelect;
type DispatchRow = typeof notificationDispatches.$inferSelect;
type DirectiveRow = typeof decisionDirectives.$inferSelect;

/** What a record's content hash covers: every column except its own id and hash. */
type RecordContent<Row> = Omit<Row, "id" | "contentHash">;

/** One recommendation, every decision on it, and every dispatch of and directive on those decisions. */
interface DecisionChain {
  readonly recommendation: RecommendationRow;
  readonly decisions: readonly DecisionRow[];
  readonly dispatches: readonly DispatchRow[];
  readonly directives: readonly DirectiveRow[];
}

interface ChainBreak {
  readonly record: ChainRecord;
  readonly id: number;
  readonly reason: ChainBreakReason;
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

/** Each root-to-leaf path: recommendation, one decision, and one of that decision's dispatches or directives when it has any. */
function chainPaths({
  recommendation,
  decisions: chain,
  dispatches,
  directives,
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
    const leaves: StoredRecord[] = [
      ...dispatches
        .filter(({ decisionId }) => decisionId === decision.id)
        .map((row) => ({
          record: "notification_dispatch" as const,
          row,
          parentHash: row.decisionHash,
        })),
      ...directives
        .filter(({ decisionId }) => decisionId === decision.id)
        .map((row) => ({
          record: "directive" as const,
          row,
          parentHash: row.decisionHash,
        })),
    ];
    if (leaves.length === 0) {
      return [[root, decisionRecord]];
    }
    return leaves.map((leaf): [StoredRecord, ...StoredRecord[]] => [
      root,
      decisionRecord,
      leaf,
    ]);
  });
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
  return [...breaks.values()];
}

export type { DecisionChain, RecordContent };
export { CHAIN_RECORDS, findChainBreaks };
