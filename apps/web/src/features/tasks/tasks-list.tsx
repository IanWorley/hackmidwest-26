import { type JSX, useId } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Tasks } from "./load-tasks";

const DONE_COLUMN = "Done";
const TASK_COLUMN = "Task";

function TaskRow({ task }: { task: Tasks[number] }): JSX.Element {
  const titleId = useId();
  return (
    <TableRow>
      <TableCell>
        <input
          aria-labelledby={titleId}
          checked={task.completed}
          className="size-4 accent-primary"
          readOnly={true}
          type="checkbox"
        />
      </TableCell>
      <TableCell id={titleId}>{task.title}</TableCell>
    </TableRow>
  );
}

export function TasksList({ tasks }: { tasks: Tasks }): JSX.Element {
  return (
    <Table aria-label="Tasks">
      <TableHeader>
        <TableRow>
          <TableHead className="w-16">{DONE_COLUMN}</TableHead>
          <TableHead>{TASK_COLUMN}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} />
        ))}
      </TableBody>
    </Table>
  );
}
