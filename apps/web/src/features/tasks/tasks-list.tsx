import type { JSX } from "react";
import type { Tasks } from "./load-tasks";

export function TasksList({ tasks }: { tasks: Tasks }): JSX.Element {
  return (
    <ul aria-label="Tasks">
      {tasks.map((task) => (
        <li key={task.id}>
          <label>
            <input type="checkbox" checked={task.completed} readOnly={true} />
            {task.title}
          </label>
        </li>
      ))}
    </ul>
  );
}
