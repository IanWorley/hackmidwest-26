import { createFileRoute, Link } from "@tanstack/react-router";

const TASKS_LINK_TEXT = "Open the project tasks";

export const Route = createFileRoute("/")({
  component: () => <Link to="/tasks">{TASKS_LINK_TEXT}</Link>,
});
