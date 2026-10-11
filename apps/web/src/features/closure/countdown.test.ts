import { expect, it } from "vitest";
import { formatCountdown } from "./countdown";

const DECIDE_BY = Date.parse("2026-10-12T10:00:00Z");

it.each([
  ["2026-10-12T06:55:30Z", "3 h 4 min left to decide"],
  ["2026-10-12T09:18:00Z", "42 min left to decide"],
  ["2026-10-12T09:59:30Z", "Less than a minute left to decide"],
  ["2026-10-12T10:00:00Z", "Decision deadline just passed"],
  ["2026-10-12T11:12:00Z", "Decision deadline passed 1 h 12 min ago"],
])("at %s reads %j", (now, text) => {
  expect(formatCountdown(DECIDE_BY, Date.parse(now))).toBe(text);
});
