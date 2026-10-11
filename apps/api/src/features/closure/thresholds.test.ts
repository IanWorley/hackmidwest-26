import { describe, expect, it } from "vitest";
import { POSTURES } from "./postures";
import { type Cutoff, HAZARDS, NWS_SEVERITIES, THRESHOLDS } from "./thresholds";

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
