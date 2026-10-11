import { createFileRoute } from "@tanstack/react-router";
import type { JSX } from "react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { FacilitiesList } from "@/features/closure/facilities-list";
import { loadFacilities } from "@/features/closure/load-facilities";
import { pageTitle } from "@/lib/page-title";

const PAGE_TITLE = pageTitle("Facilities");
const LOADING_TEXT = "Loading facilities...";
const LOAD_ERROR_TEXT = "Facilities could not be loaded.";

function FacilitiesPage(): JSX.Element {
  const facilities = Route.useLoaderData();
  return <FacilitiesList facilities={facilities} />;
}

// An index route, so the sibling detail route renders without an Outlet here.
// Router's generator owns this route identifier; it must remain a file-matching literal.
export const Route = createFileRoute("/facilities/")({
  head: () => ({ meta: [{ title: PAGE_TITLE }] }),
  loader: ({ abortController }) =>
    loadFacilities({ signal: abortController.signal }),
  component: FacilitiesPage,
  pendingComponent: () => <p>{LOADING_TEXT}</p>,
  errorComponent: () => (
    <Alert variant="destructive">
      <AlertTitle>{LOAD_ERROR_TEXT}</AlertTitle>
    </Alert>
  ),
});
