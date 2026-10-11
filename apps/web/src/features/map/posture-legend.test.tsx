import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { PostureLegend } from "./posture-legend";

it("lists every standing by its label, least to most disruptive, then not evaluated", () => {
  render(<PostureLegend />);
  const legend = screen.getByRole("list", { name: "Posture legend" });
  expect(
    within(legend)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual([
    "Normal operations",
    "Delayed arrival",
    "Early dismissal",
    "Unscheduled telework",
    "Full closure",
    "Not evaluated",
  ]);
});
