interface FacilityDayRecommendation {
  readonly snapshot: { readonly output: { readonly facilityDate: string } };
}

/** The server names the facility's current day by the engine's rule, which rolls over at closing time, not midnight. */
export function isForFacilityDay(
  recommendation: FacilityDayRecommendation,
  facilityDate: string,
): boolean {
  return recommendation.snapshot.output.facilityDate === facilityDate;
}
