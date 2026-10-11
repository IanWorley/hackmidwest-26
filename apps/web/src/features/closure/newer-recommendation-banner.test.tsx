import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { NewerRecommendationBanner } from "./newer-recommendation-banner";
import {
  type ComparedRecommendation,
  recommendationChanges,
} from "./recommendation-changes";

const DECIDED: ComparedRecommendation = {
  id: 7,
  posture: "delayed_arrival",
  confidence: "medium",
  snapshot: {
    output: {
      facilityDate: "2026-01-15",
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
  posture: "full_closure",
  confidence: "high",
  snapshot: { output: { facilityDate: "2026-01-15", findings: [] } },
};

it("reports the posture, confidence, and hazard-window changes between two recommendations", () => {
  expect(recommendationChanges(DECIDED, LATEST)).toEqual([
    { field: "posture", from: "delayed_arrival", to: "full_closure" },
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
