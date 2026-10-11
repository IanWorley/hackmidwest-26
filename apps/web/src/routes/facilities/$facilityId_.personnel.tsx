import {
  type AnyRouteMatch,
  createFileRoute,
  Link,
  useRouter,
} from "@tanstack/react-router";
import { type JSX, useCallback } from "react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { loadFacilityPersonnel } from "@/features/closure/load-facilities";
import { PersonnelRoster } from "@/features/closure/personnel-roster";
import {
  type RecordOutcome,
  recordEmployeeStatus,
  type StatusBody,
} from "@/features/closure/record-status";
import {
  formatClock,
  formatFacilityDay,
} from "@/features/closure/status-reason";
import { pageTitle } from "@/lib/page-title";

const PAGE_HEADING = "People and status";
const DECISION_LINK_TEXT = "Who's notified and why";
const STATUS_FOR_PREFIX = "Status for";
const AS_OF_TEXT = "as of";
const NOT_FOUND_TITLE = "Facility not found";
const NOT_FOUND_TEXT = `${NOT_FOUND_TITLE}.`;
const LOADING_TITLE = "Loading personnel";
const LOADING_TEXT = `${LOADING_TITLE}...`;
const LOAD_ERROR_TITLE = "Personnel could not be loaded";
const LOAD_ERROR_TEXT = `${LOAD_ERROR_TITLE}.`;

/** The title names the state the page renders, so a pending or failed load is not called "not found". */
function personnelTitle(
  facilityName: string | undefined,
  status: AnyRouteMatch["status"],
): string {
  if (facilityName !== undefined) {
    return `${PAGE_HEADING} · ${facilityName}`;
  }
  if (status === "notFound") {
    return NOT_FOUND_TITLE;
  }
  if (status === "error") {
    return LOAD_ERROR_TITLE;
  }
  return LOADING_TITLE;
}

function PersonnelPage(): JSX.Element {
  const { facility, personnel, rollsOverAt } = Route.useLoaderData();
  const router = useRouter();
  const reload = useCallback(
    (): Promise<void> => router.invalidate({ sync: true }),
    [router],
  );

  async function recordStatus(
    employeeId: number,
    body: StatusBody,
  ): Promise<RecordOutcome> {
    try {
      const outcome = await recordEmployeeStatus(employeeId, body);
      if (outcome.kind === "recorded") {
        await reload();
      }
      return outcome;
    } catch (cause) {
      // The request may have been saved before the connection failed, so show what was stored.
      await reload();
      throw cause;
    }
  }

  return (
    <article className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-heading font-semibold text-2xl">{PAGE_HEADING}</h1>
        <p className="text-muted-foreground">
          {`${facility.name}. ${STATUS_FOR_PREFIX} ${formatFacilityDay(personnel.facilityDate)}, ${AS_OF_TEXT} ${formatClock(personnel.asOf, facility.timezone)} (${facility.timezone}).`}
        </p>
        {personnel.decision !== null && (
          <Link
            className="underline underline-offset-4"
            params={{ facilityId: String(facility.id) }}
            to="/facilities/$facilityId"
          >
            {DECISION_LINK_TEXT}
          </Link>
        )}
      </header>
      <PersonnelRoster
        personnel={personnel}
        onReload={reload}
        recordStatus={recordStatus}
        rollsOverAt={rollsOverAt}
        timeZone={facility.timezone}
      />
    </article>
  );
}

// Router's generator owns this route identifier; it must remain a file-matching literal.
// The trailing underscore keeps this page a sibling of the facility page, not a child that needs its Outlet.
export const Route = createFileRoute("/facilities/$facilityId_/personnel")({
  loader: ({ params, abortController }) =>
    loadFacilityPersonnel({
      facilityId: params.facilityId,
      signal: abortController.signal,
    }),
  // After loader, so TypeScript infers loaderData from it.
  head: ({ loaderData, match }) => ({
    meta: [
      {
        title: pageTitle(
          personnelTitle(loaderData?.facility.name, match.status),
        ),
      },
    ],
  }),
  component: PersonnelPage,
  pendingComponent: () => <p>{LOADING_TEXT}</p>,
  notFoundComponent: () => <p>{NOT_FOUND_TEXT}</p>,
  errorComponent: () => (
    <Alert variant="destructive">
      <AlertTitle>{LOAD_ERROR_TEXT}</AlertTitle>
    </Alert>
  ),
});
