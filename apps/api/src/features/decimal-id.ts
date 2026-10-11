import { Option } from "effect";
import { t } from "elysia";

/** Decimal digits only, so `0x1` or `1e0` cannot alias id 1 the way numeric coercion would. */
const DECIMAL_ID_PATTERN = "^[1-9][0-9]*$";

const decimalIdParams = t.Object({
  id: t.String({ pattern: DECIMAL_ID_PATTERN }),
});

/** Past the safe range, Number rounds to a different id, so such an id matches no row. */
function parseDecimalId(decimal: string): Option.Option<number> {
  const id = Number(decimal);
  if (!Number.isSafeInteger(id)) {
    return Option.none();
  }
  return Option.some(id);
}

export { decimalIdParams, parseDecimalId };
