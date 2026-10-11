import { HAZARDS, POSTURES, ROAD_CLASSES } from "@hackmidwest/db";
import { KANSAS_CITY, YAKIMA } from "@hackmidwest/db/demo-facilities";
import { describe, expect, it } from "vitest";
import {
  type Cutoff,
  NWS_SEVERITIES,
  postHazardBuffer,
  THRESHOLDS,
  TIMING_POLICY,
} from "./thresholds";

interface CitedEntry {
  readonly path: string;
  readonly source: unknown;
  readonly citation: unknown;
}

function collectCitedEntries(node: unknown, path: string): CitedEntry[] {
  if (typeof node !== "object" || node === null) {
    return [];
  }
  const children = Object.entries(node).flatMap(([key, child]) =>
    collectCitedEntries(child, `${path}.${key}`),
  );
  if (!("value" in node)) {
    return children;
  }
  const source = "source" in node && node.source;
  const citation = "citation" in node && node.citation;
  return [{ path, source, citation }, ...children];
}

function cutoffRank(cutoff: Cutoff): number {
  if (cutoff.unit === "nws_severity") {
    return NWS_SEVERITIES.indexOf(cutoff.value);
  }
  return cutoff.value;
}

it.each([
  ...collectCitedEntries(THRESHOLDS, "THRESHOLDS"),
  ...collectCitedEntries(TIMING_POLICY, "TIMING_POLICY"),
])("$path cites a source and citation", ({ source, citation }) => {
  expect(typeof source === "string" && source.trim()).toBeTruthy();
  expect(typeof citation === "string" && citation.trim()).toBeTruthy();
});

describe("THRESHOLDS", () => {
  it.each(HAZARDS)(
    "%s cutoffs escalate posture as the value rises",
    (hazard) => {
      const cutoffs: readonly Cutoff[] = Object.values(
        THRESHOLDS[hazard].cutoffs,
      );
      const postureRanks = [...cutoffs]
        .sort((a, b) => cutoffRank(a) - cutoffRank(b))
        .map((cutoff) => POSTURES.indexOf(cutoff.posture));
      expect(postureRanks).toEqual([...postureRanks].sort((a, b) => a - b));
    },
  );
});

describe("postHazardBuffer", () => {
  it("waits longer after winter for Yakima's rural roads than Kansas City's metro core", () => {
    expect({
      yakima: postHazardBuffer("winter", YAKIMA.roadClass).value,
      kansasCity: postHazardBuffer("winter", KANSAS_CITY.roadClass).value,
    }).toEqual({ yakima: 540, kansasCity: 180 });
  });

  it("never shortens the winter buffer as the road class gets quieter", () => {
    const minutes = ROAD_CLASSES.map(
      (roadClass) => postHazardBuffer("winter", roadClass).value,
    );
    expect(minutes).toEqual([...minutes].sort((a, b) => a - b));
  });

  it("gives every road class the same wind buffer", () => {
    expect(
      ROAD_CLASSES.map(
        (roadClass) => postHazardBuffer("wind", roadClass).value,
      ),
    ).toEqual([60, 60, 60, 60, 60]);
  });
});
