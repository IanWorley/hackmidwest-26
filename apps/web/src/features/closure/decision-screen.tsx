import { type JSX, useCallback, useState } from "react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DecideByCountdown } from "./decide-by-countdown";
import {
  type DecisionRequest,
  type DecisionScreen,
  type DirectiveRequest,
  decide,
  evaluateFacility,
  issueDirective,
  type Recommendation,
} from "./decision-api";
import { BackupNotice, DecisionHistory } from "./decision-history";
import { DecisionPanel } from "./decision-panel";
import { DirectivesSection } from "./directives-section";
import { FacilityHours, HazardBadges } from "./facility-fields";
import { RecommendationView } from "./recommendation-view";
import { useNow } from "./use-now";

const TIME_ZONE_LABEL = "Time zone";
const HOURS_LABEL = "Hours";
const NWS_ZONE_LABEL = "NWS zone";
const HAZARDS_LABEL = "Hazards";
const RECOMMENDATION_HEADING = "Recommendation";
const NO_RECOMMENDATION_TEXT =
  "No recommendation yet. Re-evaluate to pull live conditions and get one.";
const REEVALUATE_LABEL = "Re-evaluate";
const EVALUATING_LABEL = "Evaluating…";
const EVALUATED_TEXT = "New recommendation loaded.";
const EVALUATE_FAILED_TEXT =
  "Re-evaluation failed. The weather services may be unavailable; try again.";

/** A deferral or a missed deadline sets no posture, so only these take directives. */
const ACTIONS_TAKING_DIRECTIVES: readonly string[] = ["accept", "override"];

type EvaluateState = "idle" | "evaluating" | "evaluated" | "failed";

interface ScreenProps {
  readonly screen: DecisionScreen;
  readonly onReload: () => Promise<void>;
}

function FacilityDetails({
  facility,
}: {
  facility: DecisionScreen["facility"];
}): JSX.Element {
  return (
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
  );
}

function ReevaluateButton({
  facilityId,
  onReload,
}: {
  facilityId: number;
  onReload: () => Promise<void>;
}): JSX.Element {
  const [state, setState] = useState<EvaluateState>("idle");
  let label = REEVALUATE_LABEL;
  if (state === "evaluating") {
    label = EVALUATING_LABEL;
  }
  const reevaluate = useCallback(async (): Promise<void> => {
    setState("evaluating");
    if (await evaluateFacility(facilityId)) {
      await onReload();
      setState("evaluated");
      return;
    }
    setState("failed");
  }, [facilityId, onReload]);

  return (
    <>
      <Button
        disabled={state === "evaluating"}
        onClick={reevaluate}
        type="button"
        variant="outline"
      >
        {label}
      </Button>
      {state === "evaluated" && (
        <p className="basis-full" role="status">
          {EVALUATED_TEXT}
        </p>
      )}
      {state === "failed" && (
        <Alert className="basis-full" role="alert" variant="destructive">
          <AlertTitle>{EVALUATE_FAILED_TEXT}</AlertTitle>
        </Alert>
      )}
    </>
  );
}

function RecommendationSection({
  screen,
  onReload,
  now,
}: ScreenProps & { readonly now: number }): JSX.Element {
  const { facility, latestRecommendation } = screen;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading font-semibold text-xl">
          {RECOMMENDATION_HEADING}
        </h2>
        <ReevaluateButton facilityId={facility.id} onReload={onReload} />
      </div>
      {latestRecommendation === null && <p>{NO_RECOMMENDATION_TEXT}</p>}
      {latestRecommendation !== null && (
        <>
          <DecideByCountdown
            decideBy={latestRecommendation.decideBy}
            now={now}
            timeZone={facility.timezone}
          />
          <RecommendationView
            now={now}
            recommendation={latestRecommendation}
            timeZone={facility.timezone}
          />
        </>
      )}
    </section>
  );
}

function RecommendationDecision({
  screen,
  onReload,
  now,
  recommendation,
}: ScreenProps & {
  readonly now: number;
  readonly recommendation: Recommendation;
}): JSX.Element {
  const submitDecision = useCallback(
    (request: DecisionRequest): ReturnType<typeof decide> =>
      decide(recommendation.id, request),
    [recommendation.id],
  );

  return (
    <DecisionPanel
      currentDecisionId={screen.currentDecision?.id}
      decideBy={recommendation.decideBy}
      now={now}
      onReload={onReload}
      recommendedPosture={recommendation.posture}
      recorders={screen.recorders}
      submitDecision={submitDecision}
    />
  );
}

function CurrentDirectives({
  screen,
  onReload,
  decisionId,
}: ScreenProps & { readonly decisionId: number }): JSX.Element {
  const submitDirective = useCallback(
    (request: DirectiveRequest): ReturnType<typeof issueDirective> =>
      issueDirective(decisionId, request),
    [decisionId],
  );

  return (
    <DirectivesSection
      buildings={screen.buildings}
      directives={screen.directives}
      onReload={onReload}
      recorders={screen.recorders}
      submitDirective={submitDirective}
      timeZone={screen.facility.timezone}
    />
  );
}

export function DecisionScreenView({
  screen,
  onReload,
}: ScreenProps): JSX.Element {
  const now = useNow(screen.loadedAt);
  const { facility, latestRecommendation, currentDecision, history } = screen;
  return (
    <article className="space-y-8">
      <div className="space-y-4">
        <h1 className="font-heading font-semibold text-2xl">{facility.name}</h1>
        <FacilityDetails facility={facility} />
      </div>
      <BackupNotice history={history} />
      <RecommendationSection now={now} onReload={onReload} screen={screen} />
      {latestRecommendation !== null && (
        <RecommendationDecision
          now={now}
          onReload={onReload}
          recommendation={latestRecommendation}
          screen={screen}
        />
      )}
      {currentDecision !== null &&
        ACTIONS_TAKING_DIRECTIVES.includes(currentDecision.action) && (
          <CurrentDirectives
            decisionId={currentDecision.id}
            onReload={onReload}
            screen={screen}
          />
        )}
      <DecisionHistory history={history} timeZone={facility.timezone} />
    </article>
  );
}
