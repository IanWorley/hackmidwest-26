import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { NotificationRecipients } from "./notification-recipients";
import { PREVIEW, TIMEZONE } from "./notification-test-fixtures";

function rowTexts(table: HTMLElement): string[][] {
  return screen
    .getAllByRole("row")
    .filter((row) => table.contains(row))
    .map((row) =>
      Array.from(row.querySelectorAll("th, td"), (cell) => cell.textContent),
    );
}

it("lists each recipient's channel, local send-by time, and lateness, then who is left out and why", () => {
  render(<NotificationRecipients pkg={PREVIEW} timezone={TIMEZONE} />);

  expect(
    rowTexts(screen.getByRole("table", { name: "Who will be notified" })),
  ).toEqual([
    ["Name", "Channel", "Send by", "Delivery"],
    ["Ada Lovelace", "Text message", "05:30", "On time"],
    ["Grace Hopper", "Email", "22:45 2026-01-14", "Late"],
  ]);
  const excluded = screen.getByRole("list", { name: "Not notified" });
  expect(
    Array.from(excluded.querySelectorAll("li"), (item) => item.textContent),
  ).toEqual([
    "Alan Turing: Already teleworking",
    "Edsger Dijkstra: PTO",
    "Barbara Liskov: Not in HR records",
  ]);
});
