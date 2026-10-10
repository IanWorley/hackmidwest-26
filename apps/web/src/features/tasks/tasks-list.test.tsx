import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { TasksList } from "./tasks-list";

it("shows the database completion state as an accessible checked task", () => {
  render(
    <TasksList tasks={[{ id: 1, title: "Build the demo", completed: true }]} />,
  );
  const checkbox = screen.getByRole("checkbox", { name: "Build the demo" });
  expect(checkbox).toHaveProperty("checked", true);
});
