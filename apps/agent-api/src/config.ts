import { Value } from "@sinclair/typebox/value";
import { t } from "elysia";

const MIN_TCP_PORT = 1;
const MAX_TCP_PORT = 65_535;
const HTTP_PROTOCOL = "http:";
const HTTPS_PROTOCOL = "https:";
const ORIGIN_PATH = "/";

const EnvironmentSchema = t.Object({
  agentApiPort: t.String({ pattern: "^[0-9]+$" }),
  tasksApiUrl: t.String(),
});
const PortSchema = t.Integer({ minimum: MIN_TCP_PORT, maximum: MAX_TCP_PORT });

interface AgentApiConfig {
  readonly port: number;
  readonly tasksApiUrl: string;
}

export function readAgentApiConfig(
  environment: NodeJS.ProcessEnv,
): AgentApiConfig {
  const input = {
    agentApiPort: environment.AGENT_API_PORT,
    tasksApiUrl: environment.TASKS_API_URL,
  };
  if (!Value.Check(EnvironmentSchema, input)) {
    throw new Error("AGENT_API_PORT and TASKS_API_URL must be configured");
  }
  const port = Number(input.agentApiPort);
  if (!Value.Check(PortSchema, port)) {
    throw new Error("AGENT_API_PORT must be a valid TCP port");
  }
  const tasksApi = URL.parse(input.tasksApiUrl);
  if (
    tasksApi === null ||
    (tasksApi.protocol !== HTTP_PROTOCOL &&
      tasksApi.protocol !== HTTPS_PROTOCOL) ||
    tasksApi.pathname !== ORIGIN_PATH ||
    tasksApi.username !== "" ||
    tasksApi.password !== "" ||
    tasksApi.search !== "" ||
    tasksApi.hash !== ""
  ) {
    throw new Error(
      "TASKS_API_URL must be an HTTP(S) origin without credentials or a path",
    );
  }
  return { port, tasksApiUrl: tasksApi.origin };
}
