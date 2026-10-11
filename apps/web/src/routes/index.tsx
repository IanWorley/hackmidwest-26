import { createFileRoute, Link } from "@tanstack/react-router";
import type { JSX } from "react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { StandingDashboard } from "@/features/closure/standing-dashboard";
import { loadMap } from "@/features/map/load-map";
import { useRefreshEvery } from "@/lib/use-refresh-every";

const PAGE_HEADING = "Facility standing";
const CONDITIONS_LINK_TEXT = "View conditions";
const LOADING_TEXT = "Loading facility standing...";
const LOAD_ERROR_TEXT = "Facility standing could not be loaded.";
/** Matches the API's one-minute live-conditions cache, so an open dashboard picks up new recommendations and decisions. */
const REFRESH_INTERVAL_MS = 60_000;

function HomePage(): JSX.Element {
  const { facilities } = Route.useLoaderData();
  useRefreshEvery(REFRESH_INTERVAL_MS);
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-heading font-semibold text-2xl">{PAGE_HEADING}</h1>
        <Link
          className="text-sm underline-offset-4 hover:underline"
          to="/conditions"
        >
          {CONDITIONS_LINK_TEXT}
        </Link>
      </div>
      <StandingDashboard facilities={facilities} />
    </section>
  );
}

// Router's generator owns this route identifier; it must remain a file-matching literal.
export const Route = createFileRoute("/")({
  loader: ({ abortController }) => loadMap({ signal: abortController.signal }),
  component: HomePage,
  pendingComponent: () => <p>{LOADING_TEXT}</p>,
  errorComponent: () => (
    <Alert variant="destructive">
      <AlertTitle>{LOAD_ERROR_TEXT}</AlertTitle>
    </Alert>
  ),
});
