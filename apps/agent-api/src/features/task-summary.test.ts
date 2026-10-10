import { createServer, type RequestListener } from "node:http";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import {
  createAgentApiRuntime,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_OK,
  INTERNAL_ERROR_MESSAGE,
} from "../runtime";
import { createTasksApiClient } from "../tasks-api";
import { TASK_SUMMARY_PATH } from "./task-summary";

const REQUEST_ORIGIN = "http://agent-api.test";
const LOOPBACK_HOST = "127.0.0.1";
const ANY_FREE_PORT = 0;
const TASKS_API_LIST_PATH = "/api/tasks";
const HTTP_NOT_FOUND = 404;

type TasksApiReply = { readonly status: number; readonly body: unknown };

async function withTasksApi(
  reply: TasksApiReply,
  run: (app: ReturnType<typeof createApp>) => Promise<void>,
): Promise<void> {
  const listener: RequestListener = (request, response) => {
    const isListTasks =
      request.method === "GET" && request.url === TASKS_API_LIST_PATH;
    response.writeHead(isListTasks ? reply.status : HTTP_NOT_FOUND, {
      "content-type": "application/json",
    });
    response.end(isListTasks ? JSON.stringify(reply.body) : "");
  };
  const server = createServer(listener);
  await new Promise<void>((resolve) =>
    server.listen(ANY_FREE_PORT, LOOPBACK_HOST, resolve),
  );
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected the stub tasks API to listen on a TCP port");
  }
  const runtime = createAgentApiRuntime(
    createTasksApiClient(`http://${LOOPBACK_HOST}:${address.port}`),
  );
  try {
    await run(createApp({ runRequest: runtime.runRequest }));
  } finally {
    try {
      await runtime.dispose();
    } finally {
      server.close();
    }
  }
}

function getSummary(): Request {
  return new Request(new URL(TASK_SUMMARY_PATH, REQUEST_ORIGIN));
}

describe(`GET ${TASK_SUMMARY_PATH}`, () => {
  it("counts completed and open tasks read from the tasks API", () =>
    withTasksApi(
      {
        status: HTTP_OK,
        body: [
          { id: 1, title: "Build the demo", completed: true },
          { id: 2, title: "Write the talk", completed: false },
          { id: 3, title: "Ship it", completed: false },
        ],
      },
      async (app) => {
        const response = await app.handle(getSummary());

        expect(response.status).toBe(HTTP_OK);
        expect(await response.json()).toEqual({
          total: 3,
          completed: 1,
          open: 2,
        });
      },
    ));

  it("returns a generic 500 when the tasks API fails", () =>
    withTasksApi(
      {
        status: HTTP_INTERNAL_SERVER_ERROR,
        body: { message: INTERNAL_ERROR_MESSAGE },
      },
      async (app) => {
        const response = await app.handle(getSummary());

        expect(response.status).toBe(HTTP_INTERNAL_SERVER_ERROR);
        expect(await response.json()).toEqual({
          message: INTERNAL_ERROR_MESSAGE,
        });
      },
    ));
});
