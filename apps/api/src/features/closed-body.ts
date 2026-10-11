import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { ValidationError } from "elysia";

/** Elysia's default normalize strips fields a closed schema forbids before validating, so check the raw body first and let the route's error hook name the unknown field. */
function rejectUnknownFields(schema: TSchema) {
  return ({ body }: { body: unknown }): void => {
    if (!Value.Check(schema, body)) {
      throw new ValidationError("body", schema, body);
    }
  };
}

export { rejectUnknownFields };
