import { type AnyRouteMatch, createFileRoute } from "@tanstack/react-router";
import type { JSX } from "react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import {
  FacilityHours,
  HazardBadges,
} from "@/features/closure/facility-fields";
import { loadFacility } from "@/features/closure/load-facilities";
import { pageTitle } from "@/lib/page-title";

const NOT_FOUND_TITLE = "Facility not found";
const NOT_FOUND_TEXT = `${NOT_FOUND_TITLE}.`;
const TIME_ZONE_LABEL = "Time zone";
const HOURS_LABEL = "Hours";
const NWS_ZONE_LABEL = "NWS zone";
const HAZARDS_LABEL = "Hazards";
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
  const facility = Route.useLoaderData();
  return (
    <article className="space-y-6">
      <h1 className="font-heading font-semibold text-2xl">{facility.name}</h1>
      <dl className="grid w-fit grid-cols-2 gap-x-6 gap-y-2">
        <dt className="text-muted-foreground">{TIME_ZONE_LABEL}</dt>
        <dd>{facility.timezone}</dd>
        <dt className="text-muted-foreground">{HOURS_LABEL}</dt>
        <dd>
          <FacilityHours facility={facility} />
        </dd>
        <dt className="text-muted-foreground">{NWS_ZONE_LABEL}</dt>
        <dd>{facility.nwsZone}</dd>
        <dt className="text-muted-foreground">{HAZARDS_LABEL}</dt>
        <dd>
          <HazardBadges hazards={facility.hazards} />
        </dd>
      </dl>
    </article>
  );
}

// Router's generator owns this route identifier; it must remain a file-matching literal.
export const Route = createFileRoute("/facilities/$facilityId")({
  loader: ({ params, abortController }) =>
    loadFacility({
      facilityId: params.facilityId,
      signal: abortController.signal,
    }),
  // After loader, so TypeScript infers loaderData from it.
  head: ({ loaderData, match }) => ({
    meta: [{ title: pageTitle(facilityTitle(loaderData?.name, match.status)) }],
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
