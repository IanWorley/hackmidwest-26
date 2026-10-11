import type {
  decisionDirectives,
  decisions,
  humanInputs,
  notificationDispatches,
  recommendations,
} from "@hackmidwest/db";
import { t } from "elysia";
import { decisionHash, dispatchHash } from "./decision-store";
import { directiveHash } from "./directive-store";
import { recommendationHash } from "./recommendation-store";

const CHAIN_LINK_KINDS = [
  "recommendation",
  "decision",
  "directive",
  "notification_dispatch",
] as const;

const LINK_FAULTS = [
  "content_hash_mismatch",
  "parent_hash_mismatch",
  "missing_parent",
  "missing_predecessor",
] as const;

type ChainLinkKind = (typeof CHAIN_LINK_KINDS)[number];
type LinkFault = (typeof LINK_FAULTS)[number];

const linkIdentity = { kind: t.UnionEnum(CHAIN_LINK_KINDS), id: t.Integer() };

const ChainLinkSchema = t.Union([
  t.Object({ ...linkIdentity, ok: t.Literal(true) }),
  t.Object({
    ...linkIdentity,
    ok: t.Literal(false),
    faults: t.Array(t.UnionEnum(LINK_FAULTS), { minItems: 1 }),
  }),
]);

const ChainVerificationSchema = t.Object({
  decisionId: t.Integer(),
  ok: t.Boolean(),
  links: t.Array(ChainLinkSchema),
});

type ChainLink = typeof ChainLinkSchema.static;
type ChainVerification = typeof ChainVerificationSchema.static;

interface StoredChain {
  readonly recommendation: typeof recommendations.$inferSelect;
  readonly decisions: readonly {
    readonly row: typeof decisions.$inferSelect;
    readonly humanInputs: readonly (typeof humanInputs.$inferSelect)[];
  }[];
  readonly directives: readonly (typeof decisionDirectives.$inferSelect)[];
  readonly dispatches: readonly (typeof notificationDispatches.$inferSelect)[];
}

interface HashedRow {
  readonly kind: ChainLinkKind;
  readonly id: number;
  readonly storedHash: string;
  readonly recomputedHash: string;
  /** `storedHash` is undefined when the parent row is not on the loaded chain. */
  readonly parent?: {
    readonly copiedHash: string;
    readonly storedHash: string | undefined;
  };
  readonly missingPredecessor?: boolean;
}

function checkLink({
  kind,
  id,
  storedHash,
  recomputedHash,
  parent,
  missingPredecessor,
}: HashedRow): ChainLink {
  const faults: LinkFault[] = [];
  if (storedHash !== recomputedHash) {
    faults.push("content_hash_mismatch");
  }
  if (parent !== undefined) {
    if (parent.storedHash === undefined) {
      faults.push("missing_parent");
    } else if (parent.copiedHash !== parent.storedHash) {
      faults.push("parent_hash_mismatch");
    }
  }
  if (missingPredecessor === true) {
    faults.push("missing_predecessor");
  }
  const [first, ...rest] = faults;
  if (first === undefined) {
    return { kind, id, ok: true };
  }
  return { kind, id, ok: false, faults: [first, ...rest] };
}

function verifyChain(
  decisionId: number,
  chain: StoredChain,
): ChainVerification {
  const { recommendation } = chain;
  const decisionHashes = new Map(
    chain.decisions.map(({ row }) => [row.id, row.contentHash]),
  );
  const links = [
    checkLink({
      kind: "recommendation",
      id: recommendation.id,
      storedHash: recommendation.contentHash,
      recomputedHash: recommendationHash(recommendation),
    }),
    ...chain.decisions.map(({ row, humanInputs: inputs }) =>
      checkLink({
        kind: "decision",
        id: row.id,
        storedHash: row.contentHash,
        recomputedHash: decisionHash({ ...row, humanInputs: inputs }),
        parent: {
          copiedHash: row.recommendationHash,
          storedHash: recommendation.contentHash,
        },
        missingPredecessor:
          row.supersedesDecisionId !== null &&
          !decisionHashes.has(row.supersedesDecisionId),
      }),
    ),
    ...chain.directives.map((directive) =>
      checkLink({
        kind: "directive",
        id: directive.id,
        storedHash: directive.contentHash,
        recomputedHash: directiveHash(directive),
        parent: {
          copiedHash: directive.decisionHash,
          storedHash: decisionHashes.get(directive.decisionId),
        },
      }),
    ),
    ...chain.dispatches.map((dispatch) =>
      checkLink({
        kind: "notification_dispatch",
        id: dispatch.id,
        storedHash: dispatch.contentHash,
        recomputedHash: dispatchHash(dispatch),
        parent: {
          copiedHash: dispatch.decisionHash,
          storedHash: decisionHashes.get(dispatch.decisionId),
        },
      }),
    ),
  ];
  return { decisionId, ok: links.every((link) => link.ok), links };
}

export type { StoredChain };
export { ChainVerificationSchema, verifyChain };
