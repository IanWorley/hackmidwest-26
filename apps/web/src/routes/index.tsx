import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: () => <Link to="/tasks">Open the project tasks</Link>,
});
