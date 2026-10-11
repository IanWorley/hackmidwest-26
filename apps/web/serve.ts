import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createEnv, type StandardSchemaV1 } from "@t3-oss/env-core";
import { file, serve } from "bun";
import { z } from "zod";

const MIN_TCP_PORT = 1;
const MAX_TCP_PORT = 65_535;
const DECIMAL_DIGITS = /^[0-9]+$/u;
const CLIENT_DIRECTORY = fileURLToPath(
  new URL("dist/client/", import.meta.url),
);
const START_SERVER_ENTRY = new URL("dist/server/server.js", import.meta.url)
  .href;

type FetchHandler = (request: Request) => Response | Promise<Response>;

const startServerModule = z.object({
  default: z.object({
    fetch: z.custom<FetchHandler>((value) => typeof value === "function"),
  }),
});

function tcpPort(name: string): z.ZodType<number, string> {
  const invalid = `${name} must be a valid TCP port`;
  return z
    .string({ error: `${name} must be configured` })
    .regex(DECIMAL_DIGITS, invalid)
    .transform(Number)
    .pipe(z.int().min(MIN_TCP_PORT, invalid).max(MAX_TCP_PORT, invalid));
}

function throwConfigError(issues: readonly StandardSchemaV1.Issue[]): never {
  throw new Error(issues.map((issue) => issue.message).join("\n"));
}

const env = createEnv({
  server: { WEB_PORT: tcpPort("WEB_PORT") },
  // createEnv deletes blank keys from runtimeEnv, so it gets a copy.
  runtimeEnv: { ...process.env },
  emptyStringAsUndefined: true,
  onValidationError: throwConfigError,
});

// The Start server bundle renders pages but does not serve the client build.
const start = startServerModule.parse(await import(START_SERVER_ENTRY));

async function readClientFile(pathname: string): Promise<Response | null> {
  const path = resolve(CLIENT_DIRECTORY, `.${pathname}`);
  if (!path.startsWith(CLIENT_DIRECTORY)) {
    return null;
  }
  const clientFile = file(path);
  if (!(await clientFile.exists())) {
    return null;
  }
  return new Response(clientFile);
}

serve({
  port: env.WEB_PORT,
  async fetch(request: Request): Promise<Response> {
    const response = await readClientFile(new URL(request.url).pathname);
    return response ?? start.default.fetch(request);
  },
});
