/** Negative when `left` comes first. Every order the engine picks with must be total, so input order never decides. */
type Order<Item> = (left: Item, right: Item) => number;

function firstBy<Item>(
  items: readonly Item[],
  order: Order<Item>,
): Item | undefined {
  return items.reduce<Item | undefined>((best, item) => {
    if (best === undefined || order(item, best) < 0) {
      return item;
    }
    return best;
  }, undefined);
}

/** Code-unit order, so the result does not depend on the runtime's locale. */
function byText(left: string, right: string): number {
  return Number(left > right) - Number(left < right);
}

export type { Order };
export { byText, firstBy };
