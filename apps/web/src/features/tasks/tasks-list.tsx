import type { Tasks } from "./load-tasks";

export function TasksList({ tasks }: { tasks: Tasks }) {
  return (
    <ul aria-label="Tasks">
      {tasks.map((task) => (
        <li key={task.id}>
          <label>
            <input type="checkbox" checked={task.completed} readOnly />
            {task.title}
          </label>
        </li>
      ))}
    </ul>
  );
}
