import { readDatabaseLocation } from "@hackmidwest/db";
import { Value } from "@sinclair/typebox/value";
import { t } from "elysia";

const MIN_TCP_PORT = 1;
const MAX_TCP_PORT = 65_535;
const HTTP_PROTOCOL = "http:";
const HTTPS_PROTOCOL = "https:";
const ORIGIN_PATH = "/";

const EnvironmentSchema = t.Object({
  API_PORT: t.String({ pattern: "^[0-9]+$" }),
  WEB_ORIGIN: t.String(),
});
const PortSchema = t.Integer({ minimum: MIN_TCP_PORT, maximum: MAX_TCP_PORT });

/** Fail startup before opening a connection or listener when configuration is invalid. */
export function readApiConfig(environment: NodeJS.ProcessEnv) {
  const input = {
    API_PORT: environment.API_PORT,
    WEB_ORIGIN: environment.WEB_ORIGIN,
  };
  if (!Value.Check(EnvironmentSchema, input)) {
    throw new Error("API_PORT and WEB_ORIGIN must be configured");
  }
  const port = Number(input.API_PORT);
  if (!Value.Check(PortSchema, port)) {
    throw new Error("API_PORT must be a valid TCP port");
  }
  const origin = new URL(input.WEB_ORIGIN);
  if (
    (origin.protocol !== HTTP_PROTOCOL && origin.protocol !== HTTPS_PROTOCOL) ||
    origin.pathname !== ORIGIN_PATH ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.search !== "" ||
    origin.hash !== ""
  ) {
    throw new Error(
      "WEB_ORIGIN must be an HTTP(S) origin without credentials or a path",
    );
  }
  const database = readDatabaseLocation(environment);
  return { port, webOrigin: origin.origin, database };
}
