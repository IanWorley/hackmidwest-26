import { HAZARDS } from "@hackmidwest/db";
import { describe, expect, it } from "vitest";
import type { FloodCategory } from "../../clients/nwps";
import { POSTURES } from "./postures";
import {
  type Cutoff,
  NWS_SEVERITIES,
  type NwsSeverity,
  THRESHOLDS,
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

// Ranks a flood category on the severity scale so a hazard can mix alert and gauge cutoffs.
const SEVERITY_OF_FLOOD_CATEGORY = {
  action: "Minor",
  minor: "Moderate",
  moderate: "Severe",
  major: "Extreme",
} as const satisfies Record<FloodCategory, NwsSeverity>;

function cutoffRank(cutoff: Cutoff): number {
  switch (cutoff.unit) {
    case "nws_severity":
      return NWS_SEVERITIES.indexOf(cutoff.value);
    case "nws_flood_category":
      return NWS_SEVERITIES.indexOf(SEVERITY_OF_FLOOD_CATEGORY[cutoff.value]);
    default:
      return cutoff.value;
  }
}

describe("THRESHOLDS", () => {
  it.each(collectCitedEntries(THRESHOLDS, "THRESHOLDS"))(
    "$path cites a source and citation",
    ({ source, citation }) => {
      expect(typeof source === "string" && source.trim()).toBeTruthy();
      expect(typeof citation === "string" && citation.trim()).toBeTruthy();
    },
  );

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
