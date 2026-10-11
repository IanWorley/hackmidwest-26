interface FacilityDayRecommendation {
  readonly id: number;
  readonly snapshot: { readonly output: { readonly facilityDate: string } };
}

/** The server names the facility's current day by the engine's rule, which rolls over at closing time, not midnight. */
function isForFacilityDay(
  recommendation: FacilityDayRecommendation,
  facilityDate: string,
): boolean {
  return recommendation.snapshot.output.facilityDate === facilityDate;
}

/**
 * A decision is current only on a recommendation for the facility's current day, so yesterday's call never carries over.
 * History is newest first, so the first decision on that recommendation is the one a new decision supersedes.
 */
function currentDecisionOf<Row extends { recommendationId: number }>(
  history: readonly Row[],
  recommendation: FacilityDayRecommendation | null,
  facilityDate: string,
): Row | null {
  if (
    recommendation === null ||
    !isForFacilityDay(recommendation, facilityDate)
  ) {
    return null;
  }
  return (
    history.find(
      (decision) => decision.recommendationId === recommendation.id,
    ) ?? null
  );
}

export { currentDecisionOf, isForFacilityDay };
