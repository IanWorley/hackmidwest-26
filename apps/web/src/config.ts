import { createEnv, type StandardSchemaV1 } from "@t3-oss/env-core";
import { z } from "zod";

const CLIENT_PREFIX = "VITE_";
const HTTP_PROTOCOLS: readonly string[] = ["http:", "https:"];
const ORIGIN_PATH = "/";

interface WebConfig {
  readonly apiBaseUrl: string;
}

/** Vite's `loadEnv` output and `import.meta.env` both satisfy this. */
type WebEnvironment = Readonly<Record<string, string | boolean | undefined>>;

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

/** Accept a public HTTP origin usable by both Start SSR and browser navigation. */
export function readWebConfig(environment: WebEnvironment): WebConfig {
  // No isServer: with only client variables, the server and browser branches
  // of createEnv validate the same schema.
  const env = createEnv({
    clientPrefix: CLIENT_PREFIX,
    client: { VITE_API_BASE_URL: httpOrigin("VITE_API_BASE_URL") },
    // createEnv deletes blank keys from runtimeEnv, so it gets a copy.
    runtimeEnv: { ...environment },
    emptyStringAsUndefined: true,
    onValidationError: throwConfigError,
  });
  return { apiBaseUrl: env.VITE_API_BASE_URL };
}
