import { createFileRoute } from "@tanstack/react-router";
import type { JSX } from "react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { loadTasks } from "@/features/tasks/load-tasks";
import { TasksList } from "@/features/tasks/tasks-list";
import { pageTitle } from "@/lib/page-title";

const PAGE_TITLE = pageTitle("Tasks");
const LOADING_TEXT = "Loading tasks...";
const LOAD_ERROR_TEXT = "Tasks could not be loaded.";

function TasksPage(): JSX.Element {
  const tasks = Route.useLoaderData();
  return <TasksList tasks={tasks} />;
}

// Router's generator owns this route identifier; it must remain a file-matching literal.
export const Route = createFileRoute("/tasks")({
  head: () => ({ meta: [{ title: PAGE_TITLE }] }),
  loader: ({ abortController }) =>
    loadTasks({ signal: abortController.signal }),
  component: TasksPage,
  pendingComponent: () => <p>{LOADING_TEXT}</p>,
  errorComponent: () => (
    <Alert variant="destructive">
      <AlertTitle>{LOAD_ERROR_TEXT}</AlertTitle>
    </Alert>
  ),
});
