import { type DatabaseLocation, readDatabaseLocation } from "@hackmidwest/db";
import { createEnv, type StandardSchemaV1 } from "@t3-oss/env-core";
import { z } from "zod";

const MIN_TCP_PORT = 1;
const MAX_TCP_PORT = 65_535;
const DECIMAL_DIGITS = /^[0-9]+$/u;
const HTTP_PROTOCOLS: readonly string[] = ["http:", "https:"];
const ORIGIN_PATH = "/";

interface ApiConfig {
  readonly port: number;
  readonly webOrigin: string;
  readonly database: DatabaseLocation;
  readonly nwsUserAgent: string;
  readonly airNowApiKey: string | undefined;
}

function tcpPort(name: string): z.ZodType<number, string> {
  const invalid = `${name} must be a valid TCP port`;
  return z
    .string({ error: `${name} must be configured` })
    .regex(DECIMAL_DIGITS, invalid)
    .transform(Number)
    .pipe(z.int().min(MIN_TCP_PORT, invalid).max(MAX_TCP_PORT, invalid));
}

function isHttpOrigin(value: string): boolean {
  const url = URL.parse(value);
  return (
    url !== null &&
    HTTP_PROTOCOLS.includes(url.protocol) &&
    url.pathname === ORIGIN_PATH &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === ""
  );
}

function httpOrigin(name: string): z.ZodType<string, string> {
  return z
    .string({ error: `${name} must be configured` })
    .refine(
      isHttpOrigin,
      `${name} must be an HTTP(S) origin without credentials or a path`,
    )
    .transform((value) => new URL(value).origin);
}

function throwConfigError(issues: readonly StandardSchemaV1.Issue[]): never {
  throw new Error(issues.map((issue) => issue.message).join("\n"));
}

/** Fail startup before opening a connection or listener when configuration is invalid. */
export function readApiConfig(environment: NodeJS.ProcessEnv): ApiConfig {
  const env = createEnv({
    server: {
      API_PORT: tcpPort("API_PORT"),
      WEB_ORIGIN: httpOrigin("WEB_ORIGIN"),
      NWS_USER_AGENT: z.string({
        error:
          "NWS_USER_AGENT must be configured; NWS requires an app name and contact",
      }),
      AIRNOW_API_KEY: z.string().optional(),
    },
    // createEnv deletes blank keys from runtimeEnv, so it gets a copy. Bun
    // loads `KEY=` as "", which then reads as unset.
    runtimeEnv: { ...environment },
    emptyStringAsUndefined: true,
    onValidationError: throwConfigError,
  });
  return {
    port: env.API_PORT,
    webOrigin: env.WEB_ORIGIN,
    database: readDatabaseLocation(environment),
    nwsUserAgent: env.NWS_USER_AGENT,
    airNowApiKey: env.AIRNOW_API_KEY,
  };
}
