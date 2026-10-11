import {
  type AnyRouteMatch,
  createFileRoute,
  Link,
  useRouter,
} from "@tanstack/react-router";
import { type JSX, useCallback } from "react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { loadDecisionScreen } from "@/features/closure/decision-api";
import { DecisionScreenView } from "@/features/closure/decision-screen";
import { pageTitle } from "@/lib/page-title";

const PERSONNEL_LINK_TEXT = "People and status";
const NOT_FOUND_TITLE = "Facility not found";
const NOT_FOUND_TEXT = `${NOT_FOUND_TITLE}.`;
const LOADING_TITLE = "Loading facility";
const LOADING_TEXT = `${LOADING_TITLE}...`;
const LOAD_ERROR_TITLE = "Facility could not be loaded";
const LOAD_ERROR_TEXT = `${LOAD_ERROR_TITLE}.`;

/** The title names the state the page renders, so a pending or failed load is not called "not found". */
function facilityTitle(
  name: string | undefined,
  status: AnyRouteMatch["status"],
): string {
  if (name !== undefined) {
    return name;
  }
  if (status === "notFound") {
    return NOT_FOUND_TITLE;
  }
  if (status === "error") {
    return LOAD_ERROR_TITLE;
  }
  return LOADING_TITLE;
}

function FacilityPage(): JSX.Element {
  const screen = Route.useLoaderData();
  const router = useRouter();
  // `sync` waits for the loader; otherwise the router refetches in the background and a notice
  // that says the newer data is shown would appear while the old data is still on screen.
  const reload = useCallback(
    (): Promise<void> => router.invalidate({ sync: true }),
    [router],
  );
  return (
    <DecisionScreenView
      links={
        <Link
          className="underline underline-offset-4"
          params={{ facilityId: String(screen.facility.id) }}
          to="/facilities/$facilityId/personnel"
        >
          {PERSONNEL_LINK_TEXT}
        </Link>
      }
      onReload={reload}
      screen={screen}
    />
  );
}

// Router's generator owns this route identifier; it must remain a file-matching literal.
export const Route = createFileRoute("/facilities/$facilityId")({
  loader: ({ params, abortController }) =>
    loadDecisionScreen({
      facilityId: params.facilityId,
      signal: abortController.signal,
    }),
  // After loader, so TypeScript infers loaderData from it.
  head: ({ loaderData, match }) => ({
    meta: [
      {
        title: pageTitle(
          facilityTitle(loaderData?.facility.name, match.status),
        ),
      },
    ],
  }),
  component: FacilityPage,
  pendingComponent: () => <p>{LOADING_TEXT}</p>,
  notFoundComponent: () => <p>{NOT_FOUND_TEXT}</p>,
  errorComponent: () => (
    <Alert variant="destructive">
      <AlertTitle>{LOAD_ERROR_TEXT}</AlertTitle>
    </Alert>
  ),
});
