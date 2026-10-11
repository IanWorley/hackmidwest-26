import { expect, it } from "vitest";
import { formatDirectiveScope, parseDirectiveScope } from "./directive-scope";

it.each([
  [{ kind: "facility" }, "facility"],
  [{ kind: "group", group: "essential" }, "group:essential"],
  [{ kind: "building", buildingId: 12 }, "building:12"],
  [{ kind: "employee", employeeId: 3 }, "employee:3"],
] as const)("stores %j as %j and reads it back", (scope, stored) => {
  expect(formatDirectiveScope(scope)).toBe(stored);
  expect(parseDirectiveScope(stored)).toEqual(scope);
});

it.each([
  "building:0",
  "employee:007",
  "employee:9007199254740992",
  "employee:1.5",
  "group:managers",
  "facility:1",
  "team:4",
  "Facility",
])("reads %j as no scope", (stored) => {
  expect(parseDirectiveScope(stored)).toBeNull();
});
