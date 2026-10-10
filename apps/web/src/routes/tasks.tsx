import { createFileRoute } from "@tanstack/react-router";
import { loadTasks } from "../features/tasks/load-tasks";
import { TasksList } from "../features/tasks/tasks-list";

// Router's generator owns this route identifier; it must remain a file-matching literal.
export const Route = createFileRoute("/tasks")({
  loader: ({ abortController }) =>
    loadTasks({ signal: abortController.signal }),
  component: TasksPage,
  pendingComponent: () => <p>Loading tasks...</p>,
  errorComponent: () => <p role="alert">Tasks could not be loaded.</p>,
});

function TasksPage() {
  const tasks = Route.useLoaderData();
  return <TasksList tasks={tasks} />;
}
