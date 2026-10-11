import type { TObject, TProperties } from "@sinclair/typebox";
import { t } from "elysia";

/** Rejects unknown keys, so a field the schema lacks fails validation instead of being stored or returned unchecked. */
function closedObject<Properties extends TProperties>(
  properties: Properties,
): TObject<Properties> {
  return t.Object(properties, { additionalProperties: false });
}

type DeepMutable<T> = T extends readonly (infer Item)[]
  ? DeepMutable<Item>[]
  : T extends object
    ? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
    : T;

type Equal<Left, Right> =
  (<T>() => T extends Left ? true : false) extends <T>() => T extends Right
    ? true
    : false
    ? true
    : false;

/** Identical after stripping `readonly`; mutual assignability would miss an added optional field. */
type Mirrors<Domain, Schema> = Equal<DeepMutable<Domain>, DeepMutable<Schema>>;

type AssertTrue<Condition extends true> = Condition;

export type { AssertTrue, Mirrors };
export { closedObject };
