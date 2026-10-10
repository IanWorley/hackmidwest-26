import { api } from "../../lib/api";

/** Routes receive successful domain data; Eden error envelopes stop at this boundary. */
export async function loadTasks({ signal }: { signal: AbortSignal }) {
  const result = await api.api.tasks.get({ fetch: { signal } });
  if (result.error !== null) {
    throw new Error("Unable to load tasks", { cause: result.error.value });
  }
  return result.data;
}

export type Tasks = Awaited<ReturnType<typeof loadTasks>>;
