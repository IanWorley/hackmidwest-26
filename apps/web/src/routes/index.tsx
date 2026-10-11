import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

const TASKS_LINK_TEXT = "Open the project tasks";

export const Route = createFileRoute("/")({
  component: () => (
    <Button asChild={true}>
      <Link to="/tasks">{TASKS_LINK_TEXT}</Link>
    </Button>
  ),
});
