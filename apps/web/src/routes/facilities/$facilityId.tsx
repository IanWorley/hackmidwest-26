import {
  type AnyRouteMatch,
  createFileRoute,
  useRouter,
} from "@tanstack/react-router";
import { type JSX, useState } from "react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DecideByCountdown,
  useNow,
} from "@/features/closure/decide-by-countdown";
import {
  decide,
  evaluateFacility,
  issueDirective,
  loadDecisionScreen,
} from "@/features/closure/decision-api";
import {
  BackupNotice,
  DecisionHistory,
} from "@/features/closure/decision-history";
import { DecisionPanel } from "@/features/closure/decision-panel";
import { DirectivesSection } from "@/features/closure/directives-section";
import {
  FacilityHours,
  HazardBadges,
} from "@/features/closure/facility-fields";
import { RecommendationView } from "@/features/closure/recommendation-view";
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
const RECOMMENDATION_HEADING = "Recommendation";
const NO_RECOMMENDATION_TEXT =
  "No recommendation yet. Re-evaluate to pull live conditions and get one.";
const REEVALUATE_LABEL = "Re-evaluate";
const EVALUATING_LABEL = "Evaluating…";
const EVALUATE_FAILED_TEXT =
  "Re-evaluation failed. The weather services may be unavailable; try again.";

/** Postures a directive can refine; a deferral or a missed deadline set no posture to refine. */
const ACTIONS_TAKING_DIRECTIVES: readonly string[] = ["accept", "override"];

type EvaluateState = "idle" | "evaluating" | "failed";

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
  const {
    facility,
    recommendation,
    history,
    currentDecision,
    decisionMakers,
    buildings,
    directives,
    loadedAt,
  } = Route.useLoaderData();
  const router = useRouter();
  const now = useNow(loadedAt);
  const [evaluateState, setEvaluateState] = useState<EvaluateState>("idle");
  const reload = (): Promise<void> => router.invalidate();

  async function reevaluate(): Promise<void> {
    setEvaluateState("evaluating");
    if (await evaluateFacility(facility.id)) {
      await reload();
      setEvaluateState("idle");
    } else {
      setEvaluateState("failed");
    }
  }

  return (
    <article className="space-y-8">
      <div className="space-y-4">
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
      </div>
      <BackupNotice history={history} />
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-heading font-semibold text-xl">
            {RECOMMENDATION_HEADING}
          </h2>
          <Button
            disabled={evaluateState === "evaluating"}
            onClick={reevaluate}
            type="button"
            variant="outline"
          >
            {evaluateState === "evaluating"
              ? EVALUATING_LABEL
              : REEVALUATE_LABEL}
          </Button>
        </div>
        {evaluateState === "failed" && (
          <Alert role="alert" variant="destructive">
            <AlertTitle>{EVALUATE_FAILED_TEXT}</AlertTitle>
          </Alert>
        )}
        {recommendation === null ? (
          <p>{NO_RECOMMENDATION_TEXT}</p>
        ) : (
          <>
            <DecideByCountdown
              decideBy={recommendation.decideBy}
              now={now}
              timeZone={facility.timezone}
            />
            <RecommendationView
              now={now}
              recommendation={recommendation}
              timeZone={facility.timezone}
            />
          </>
        )}
      </section>
      {recommendation !== null && (
        <DecisionPanel
          currentDecision={currentDecision}
          decisionMakers={decisionMakers}
          now={now}
          onDecide={(request) => decide(recommendation.id, request)}
          onReload={reload}
          recommendation={recommendation}
        />
      )}
      {currentDecision !== null &&
        ACTIONS_TAKING_DIRECTIVES.includes(currentDecision.action) && (
          <DirectivesSection
            buildings={buildings}
            decision={currentDecision}
            decisionMakers={decisionMakers}
            directives={directives}
            onIssue={issueDirective}
            onReload={reload}
            timeZone={facility.timezone}
          />
        )}
      <DecisionHistory history={history} timeZone={facility.timezone} />
    </article>
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
