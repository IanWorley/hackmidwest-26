import { describe, expect, it } from "vitest";
import { HAZARDS, THRESHOLDS } from "./thresholds";

const citedValues = HAZARDS.flatMap((hazard) => {
  const { cutoffs, postHazardBufferMinutes, maxDelayHours } =
    THRESHOLDS[hazard];
  return [
    ...Object.entries(cutoffs).map(([key, cutoff]) => ({
      name: `${hazard}.cutoffs.${key}`,
      cited: cutoff,
    })),
    {
      name: `${hazard}.postHazardBufferMinutes`,
      cited: postHazardBufferMinutes,
    },
    { name: `${hazard}.maxDelayHours`, cited: maxDelayHours },
  ];
});

describe("THRESHOLDS", () => {
  it.each(citedValues)("$name cites a source and citation", ({ cited }) => {
    expect(cited.source.trim()).not.toBe("");
    expect(cited.citation.trim()).not.toBe("");
  });
});
