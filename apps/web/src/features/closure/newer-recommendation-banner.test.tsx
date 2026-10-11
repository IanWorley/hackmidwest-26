import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { NewerRecommendationBanner } from "./newer-recommendation-banner";
import {
  type ComparedRecommendation,
  recommendationChanges,
} from "./recommendation-changes";

const DECIDED: ComparedRecommendation = {
  id: 7,
  confidence: "medium",
  snapshot: {
    output: {
      facilityDate: "2026-01-15",
      status: { posture: "delayed_arrival", delayHours: 2 },
      findings: [
        {
          timing: {
            hazardWindow: {
              start: "2026-01-15T06:00:00.000Z",
              end: "2026-01-15T14:00:00.000Z",
            },
          },
        },
      ],
    },
  },
};

const LATEST: ComparedRecommendation = {
  id: 9,
  confidence: "high",
  snapshot: {
    output: {
      facilityDate: "2026-01-15",
      status: { posture: "full_closure" },
      findings: [],
    },
  },
};

it("reports the posture, confidence, and hazard-window changes between two recommendations", () => {
  expect(recommendationChanges(DECIDED, LATEST)).toEqual([
    {
      field: "posture",
      from: { posture: "delayed_arrival", delayHours: 2 },
      to: { posture: "full_closure" },
    },
    { field: "confidence", from: "medium", to: "high" },
    {
      field: "hazardWindow",
      from: {
        start: "2026-01-15T06:00:00.000Z",
        end: "2026-01-15T14:00:00.000Z",
      },
      to: null,
    },
  ]);
});

it("shows no banner when the decided recommendation is still the latest", () => {
  const { container } = render(
    <NewerRecommendationBanner
      decided={DECIDED}
      latest={DECIDED}
      timezone="America/Chicago"
    />,
  );
  expect(container.innerHTML).toBe("");
});

it("says the newer recommendation matches when nothing it shows changed", () => {
  render(
    <NewerRecommendationBanner
      decided={DECIDED}
      latest={{ ...DECIDED, id: 8 }}
      timezone="America/Chicago"
    />,
  );
  expect(screen.getByRole("status").textContent).toBe(
    "A newer recommendation is availablePosture, confidence, and hazard window match the recommendation you decided on.Your decision is unchanged. Record a new decision to act on it.",
  );
});

/** An early-dismissal recommendation releasing at the given time, otherwise the decided one. */
function dismissingAt(
  id: number,
  departAt: string,
  departAtLocal: string,
): ComparedRecommendation {
  return {
    ...DECIDED,
    id,
    snapshot: {
      output: {
        ...DECIDED.snapshot.output,
        status: { posture: "early_dismissal", departAt, departAtLocal },
      },
    },
  };
}

it("lists a changed release time even when both recommendations dismiss early", () => {
  render(
    <NewerRecommendationBanner
      decided={dismissingAt(DECIDED.id, "2026-01-15T20:00:00.000Z", "14:00")}
      latest={dismissingAt(LATEST.id, "2026-01-15T18:00:00.000Z", "12:00")}
      timezone="America/Chicago"
    />,
  );
  expect(screen.getByRole("list", { name: "What changed" }).textContent).toBe(
    "Posture: Early dismissal at 14:00 → Early dismissal at 12:00",
  );
});
