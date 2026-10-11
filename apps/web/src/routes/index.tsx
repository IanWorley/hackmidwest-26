import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

const TASKS_LINK_TEXT = "Open the project tasks";
const FACILITIES_LINK_TEXT = "Open the facilities";

export const Route = createFileRoute("/")({
  component: () => (
    <div className="flex flex-wrap gap-3">
      <Button asChild={true}>
        <Link to="/tasks">{TASKS_LINK_TEXT}</Link>
      </Button>
      <Button asChild={true}>
        <Link to="/facilities">{FACILITIES_LINK_TEXT}</Link>
      </Button>
    </div>
  ),
});
