import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Value } from "@sinclair/typebox/value";
import { t } from "elysia";
import type { DatabaseLocation } from "./db/client";

const MIN_TCP_PORT = 1;
const MAX_TCP_PORT = 65_535;
const MIN_PATH_LENGTH = 1;
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const HTTP_PROTOCOL = "http:";
const HTTPS_PROTOCOL = "https:";
const ORIGIN_PATH = "/";

const EnvironmentSchema = t.Object({
  API_PORT: t.String({ pattern: "^[0-9]+$" }),
  WEB_ORIGIN: t.String(),
  DB_PATH: t.String({ minLength: MIN_PATH_LENGTH }),
});
const PortSchema = t.Integer({ minimum: MIN_TCP_PORT, maximum: MAX_TCP_PORT });

/** Fail startup before opening a connection or listener when configuration is invalid. */
export function readApiConfig(environment: NodeJS.ProcessEnv) {
  const input = {
    API_PORT: environment.API_PORT,
    WEB_ORIGIN: environment.WEB_ORIGIN,
    DB_PATH: environment.DB_PATH,
  };
  if (!Value.Check(EnvironmentSchema, input)) {
    throw new Error("API_PORT, WEB_ORIGIN, and DB_PATH must be configured");
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
  const database = {
    kind: "file",
    path: resolve(REPOSITORY_ROOT, input.DB_PATH),
  } satisfies DatabaseLocation;
  return { port, webOrigin: origin.origin, database };
}
