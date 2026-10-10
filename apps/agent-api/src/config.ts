import { readDatabaseLocation } from "@hackmidwest/db";
import { Value } from "@sinclair/typebox/value";
import { t } from "elysia";

const MIN_TCP_PORT = 1;
const MAX_TCP_PORT = 65_535;

const EnvironmentSchema = t.Object({
  AGENT_API_PORT: t.String({ pattern: "^[0-9]+$" }),
});
const PortSchema = t.Integer({ minimum: MIN_TCP_PORT, maximum: MAX_TCP_PORT });

/**
 * Fail startup before opening a connection or listener when configuration is invalid.
 * Provider credentials are resolved by each vendor SDK, not here.
 */
export function readAgentApiConfig(environment: NodeJS.ProcessEnv) {
  const input = { AGENT_API_PORT: environment.AGENT_API_PORT };
  if (!Value.Check(EnvironmentSchema, input)) {
    throw new Error("AGENT_API_PORT must be configured");
  }
  const port = Number(input.AGENT_API_PORT);
  if (!Value.Check(PortSchema, port)) {
    throw new Error("AGENT_API_PORT must be a valid TCP port");
  }
  return { port, database: readDatabaseLocation(environment) };
}
