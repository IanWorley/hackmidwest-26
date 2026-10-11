import {
  type JSX,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmDecisionDialog } from "./confirm-decision-dialog";
import { DecideByCountdown } from "./decide-by-countdown";
import {
  type Decision,
  type DecisionRequest,
  type DecisionScreen,
  type DirectiveRequest,
  decide,
  evaluateFacility,
  issueDirective,
  type Posture,
  type Recommendation,
} from "./decision-api";
import { BackupNotice, DecisionHistory } from "./decision-history";
import { DecisionPanel } from "./decision-panel";
import { DirectivesSection } from "./directives-section";
import { isForFacilityDay } from "./facility-day";
import { FacilityHours, HazardBadges } from "./facility-fields";
import { formatFacilityDate } from "./format-time";
import { NewerRecommendationBanner } from "./newer-recommendation-banner";
import type { NoticeScreen } from "./notice-screen";
import { ChainSection, NotificationsSection } from "./notice-sections";
import { RecommendationView } from "./recommendation-view";
import { useConfirmedDecision } from "./use-confirmed-decision";
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
const EARLIER_DAY_PREFIX = "This recommendation is for";
const EARLIER_DAY_SUFFIX = "Re-evaluate for today.";
const EVALUATE_FAILED_TEXT =
  "Re-evaluation failed. The recommendation shown is unchanged; try again.";

type EvaluateState = "idle" | "evaluating" | "evaluated" | "failed";

interface ScreenProps {
  readonly screen: DecisionScreen;
  readonly onReload: () => Promise<void>;
}

interface NoticeProps {
  readonly notices: NoticeScreen;
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

/** Disabling the button while it works drops focus, so a finished run puts it on the new recommendation or back on the button. */
function ReevaluateButton({
  facilityId,
  onReload,
  headingRef,
}: {
  facilityId: number;
  onReload: () => Promise<void>;
  headingRef: RefObject<HTMLHeadingElement | null>;
}): JSX.Element {
  const buttonRef = useRef<HTMLButtonElement>(null);
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

  useEffect(() => {
    if (state === "evaluated") {
      headingRef.current?.focus();
    } else if (state === "failed") {
      buttonRef.current?.focus();
    }
  }, [state, headingRef]);

  let statusText = "";
  if (state === "evaluated") {
    statusText = EVALUATED_TEXT;
  }
  return (
    <>
      <Button
        disabled={state === "evaluating"}
        onClick={reevaluate}
        ref={buttonRef}
        type="button"
        variant="outline"
      >
        {label}
      </Button>
      <p className="basis-full" role="status">
        {statusText}
      </p>
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
  const headingRef = useRef<HTMLHeadingElement>(null);
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          className="font-heading font-semibold text-xl"
          ref={headingRef}
          tabIndex={-1}
        >
          {RECOMMENDATION_HEADING}
        </h2>
        <ReevaluateButton
          facilityId={facility.id}
          headingRef={headingRef}
          onReload={onReload}
        />
      </div>
      {latestRecommendation === null && <p>{NO_RECOMMENDATION_TEXT}</p>}
      {latestRecommendation !== null &&
        !isForFacilityDay(latestRecommendation, screen.facilityDate) && (
          <Alert>
            <AlertTitle>
              {`${EARLIER_DAY_PREFIX} ${formatFacilityDate(latestRecommendation.snapshot.output.facilityDate)}. ${EARLIER_DAY_SUFFIX}`}
            </AlertTitle>
          </Alert>
        )}
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
  notices,
}: ScreenProps &
  NoticeProps & {
    readonly now: number;
    readonly recommendation: Recommendation;
  }): JSX.Element {
  const record = useCallback(
    (request: DecisionRequest): ReturnType<typeof decide> =>
      decide(recommendation.id, request),
    [recommendation.id],
  );
  const { submitDecision, dialogProps } = useConfirmedDecision(record);

  return (
    <>
      <ConfirmDecisionDialog
        {...dialogProps}
        preview={notices.preview}
        timezone={screen.facility.timezone}
      />
      <DecisionPanel
        decideBy={recommendation.decideBy}
        hasCurrentDecision={screen.currentDecision !== null}
        now={now}
        onReload={onReload}
        recommendationId={recommendation.id}
        recommendedPosture={recommendation.posture}
        recorders={screen.recorders}
        submitDecision={submitDecision}
        supersedesDecisionId={screen.latestDecisionId}
      />
    </>
  );
}

function isDispatched(notices: NoticeScreen, decisionId: number): boolean {
  const { current } = notices;
  return (
    current?.decisionId === decisionId &&
    current.result.kind === "found" &&
    current.result.view.dispatches.length > 0
  );
}

function CurrentDirectives({
  screen,
  onReload,
  notices,
  decision,
  posture,
}: ScreenProps &
  NoticeProps & {
    readonly decision: Decision;
    readonly posture: Posture;
  }): JSX.Element {
  const submitDirective = useCallback(
    (request: DirectiveRequest): ReturnType<typeof issueDirective> =>
      issueDirective(decision.id, request),
    [decision.id],
  );

  return (
    <DirectivesSection
      buildings={screen.buildings}
      decision={decision}
      isDispatched={isDispatched(notices, decision.id)}
      isOnShownRecommendation={
        decision.recommendationId === screen.latestRecommendation?.id
      }
      posture={posture}
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
  notices,
}: ScreenProps & NoticeProps): JSX.Element {
  const now = useNow(screen.loadedAt);
  const { facility, latestRecommendation, currentDecision, history } = screen;

  // Past closing time the facility day, and with it what is decidable, changes, so the loader runs again.
  useEffect(() => {
    const timer = setTimeout(
      onReload,
      Date.parse(screen.rollsOverAt) - Date.now(),
    );
    return (): void => clearTimeout(timer);
  }, [screen.rollsOverAt, onReload]);

  return (
    <article className="space-y-8">
      <div className="space-y-4">
        <h1 className="font-heading font-semibold text-2xl">{facility.name}</h1>
        <FacilityDetails facility={facility} />
      </div>
      <BackupNotice history={history} />
      {notices.decidedRecommendation !== null &&
        latestRecommendation !== null && (
          <NewerRecommendationBanner
            decided={notices.decidedRecommendation}
            latest={latestRecommendation}
            timezone={facility.timezone}
          />
        )}
      <RecommendationSection now={now} onReload={onReload} screen={screen} />
      {latestRecommendation !== null &&
        isForFacilityDay(latestRecommendation, screen.facilityDate) && (
          // A held confirmation was reviewed against one recommendation, so a reload onto another drops it.
          <RecommendationDecision
            key={latestRecommendation.id}
            now={now}
            notices={notices}
            onReload={onReload}
            recommendation={latestRecommendation}
            screen={screen}
          />
        )}
      {currentDecision !== null && currentDecision.chosenPosture !== null && (
        <CurrentDirectives
          decision={currentDecision}
          notices={notices}
          onReload={onReload}
          posture={currentDecision.chosenPosture}
          screen={screen}
        />
      )}
      {notices.current !== null && (
        <NotificationsSection
          decisionId={notices.current.decisionId}
          onReload={onReload}
          result={notices.current.result}
          timezone={facility.timezone}
        />
      )}
      <DecisionHistory history={history} timeZone={facility.timezone} />
      {notices.verification !== null && (
        <ChainSection verification={notices.verification} />
      )}
    </article>
  );
}
