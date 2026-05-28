/** Small read-only helpers over the task tree for the UI. */
import { type Task, walkTasks } from "../../src/domain/types.js";

export function findTask(tasks: Task[], id: string | null): Task | null {
  if (!id) return null;
  let found: Task | null = null;
  walkTasks(tasks, (t) => {
    if (t.id === id) found = t;
  });
  return found;
}
