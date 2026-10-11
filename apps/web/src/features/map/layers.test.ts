import { expect, it } from "vitest";
import { parseLayers, withoutLayer } from "./layers";

it("drops unknown and repeated layer names and orders the rest canonically", () => {
  expect(parseLayers("radar,alerts,bogus,alerts")).toEqual(["alerts", "radar"]);
});

it("switches one layer off and drops the parameter when none remain", () => {
  expect([
    withoutLayer("alerts,radar", "radar"),
    withoutLayer("radar", "radar"),
  ]).toEqual(["alerts", undefined]);
});
