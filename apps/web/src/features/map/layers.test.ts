import { expect, it } from "vitest";
import { parseLayers } from "./layers";

it("drops unknown and repeated layer names and orders the rest canonically", () => {
  expect(parseLayers("radar,alerts,bogus,alerts")).toEqual(["alerts", "radar"]);
});
