import { type DatabaseLocation, readDatabaseLocation } from "@hackmidwest/db";
import { Value } from "@sinclair/typebox/value";
import { t } from "elysia";

const MIN_TCP_PORT = 1;
const MAX_TCP_PORT = 65_535;
const HTTP_PROTOCOL = "http:";
const HTTPS_PROTOCOL = "https:";
const ORIGIN_PATH = "/";
const MIN_USER_AGENT_LENGTH = 1;

const EnvironmentSchema = t.Object({
  apiPort: t.String({ pattern: "^[0-9]+$" }),
  webOrigin: t.String(),
});
const NwsUserAgentSchema = t.String({ minLength: MIN_USER_AGENT_LENGTH });
const PortSchema = t.Integer({ minimum: MIN_TCP_PORT, maximum: MAX_TCP_PORT });

interface ApiConfig {
  readonly port: number;
  readonly webOrigin: string;
  readonly database: DatabaseLocation;
  readonly nwsUserAgent: string;
  readonly airNowApiKey: string | undefined;
}

/** Bun loads `KEY=` from .env as "", which means the key is not set. */
function readOptional(value: string | undefined): string | undefined {
  if (value === "") {
    return undefined;
  }
  return value;
}

/** Fail startup before opening a connection or listener when configuration is invalid. */
export function readApiConfig(environment: NodeJS.ProcessEnv): ApiConfig {
  const input = {
    apiPort: environment.API_PORT,
    webOrigin: environment.WEB_ORIGIN,
  };
  if (!Value.Check(EnvironmentSchema, input)) {
    throw new Error("API_PORT and WEB_ORIGIN must be configured");
  }
  const port = Number(input.apiPort);
  if (!Value.Check(PortSchema, port)) {
    throw new Error("API_PORT must be a valid TCP port");
  }
  const origin = new URL(input.webOrigin);
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
  const nwsUserAgent = environment.NWS_USER_AGENT;
  if (!Value.Check(NwsUserAgentSchema, nwsUserAgent)) {
    throw new Error(
      "NWS_USER_AGENT must be configured; NWS requires an app name and contact",
    );
  }
  const database = readDatabaseLocation(environment);
  return {
    port,
    webOrigin: origin.origin,
    database,
    nwsUserAgent,
    airNowApiKey: readOptional(environment.AIRNOW_API_KEY),
  };
}
