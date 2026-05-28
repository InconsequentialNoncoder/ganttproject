/**
 * Pure editing operations on the {@link Project} model.
 *
 * These mutate the model in place and are deliberately storage- and
 * runtime-agnostic so they can be unit-tested in plain Node and reused by the
 * Durable Object. Callers re-run the scheduler after applying an operation.
 */
import {
  type DependencyHardness,
  DependencyType,
  type Project,
  type Task,
  walkTasks,
} from "./types.js";

export interface NewTaskInput {
  parentId?: string | null;
  name?: string;
  start?: string;
  duration?: number;
  color?: string;
  meeting?: boolean;
  notes?: string;
}

export interface TaskPatch {
  name?: string;
  start?: string;
  duration?: number;
  complete?: number;
  color?: string;
  meeting?: boolean;
  notes?: string;
  expand?: boolean;
}

function newUid(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function nextId(project: Project): string {
  let max = 0;
  walkTasks(project.tasks, (t) => {
    const n = Number(t.id);
    if (Number.isFinite(n) && n > max) max = n;
  });
  return String(max + 1);
}

export function findTask(project: Project, id: string): Task | null {
  let found: Task | null = null;
  walkTasks(project.tasks, (t) => {
    if (t.id === id) found = t;
  });
  return found;
}

/** Returns the sibling list that directly contains the task, or null. */
function containerOf(project: Project, id: string): Task[] | null {
  if (project.tasks.some((t) => t.id === id)) return project.tasks;
  let container: Task[] | null = null;
  walkTasks(project.tasks, (t) => {
    if (t.children.some((c) => c.id === id)) container = t.children;
  });
  return container;
}

export function addTask(project: Project, input: NewTaskInput = {}): Task {
  const task: Task = {
    id: nextId(project),
    uid: newUid(),
    name: input.name ?? "New task",
    color: input.color,
    meeting: input.meeting ?? false,
    start: input.start ?? project.viewDate ?? new Date().toISOString().slice(0, 10),
    duration: input.duration ?? 1,
    complete: 0,
    expand: true,
    notes: input.notes,
    dependencies: [],
    customProperties: [],
    children: [],
  };
  if (input.parentId) {
    const parent = findTask(project, input.parentId);
    if (!parent) throw new OperationError(`Parent task ${input.parentId} not found`);
    parent.children.push(task);
  } else {
    project.tasks.push(task);
  }
  return task;
}

export function updateTask(project: Project, id: string, patch: TaskPatch): Task {
  const task = findTask(project, id);
  if (!task) throw new OperationError(`Task ${id} not found`);
  if (patch.name !== undefined) task.name = patch.name;
  if (patch.start !== undefined) task.start = patch.start;
  if (patch.duration !== undefined) task.duration = patch.duration;
  if (patch.complete !== undefined) task.complete = patch.complete;
  if (patch.color !== undefined) task.color = patch.color;
  if (patch.meeting !== undefined) task.meeting = patch.meeting;
  if (patch.notes !== undefined) task.notes = patch.notes;
  if (patch.expand !== undefined) task.expand = patch.expand;
  return task;
}

export function deleteTask(project: Project, id: string): void {
  const container = containerOf(project, id);
  if (!container) throw new OperationError(`Task ${id} not found`);

  // Collect the id and all descendants.
  const removed = new Set<string>();
  const target = container.find((t) => t.id === id)!;
  walkTasks([target], (t) => removed.add(t.id));

  const idx = container.findIndex((t) => t.id === id);
  container.splice(idx, 1);

  // Drop dependencies pointing into the removed subtree (those originating
  // from removed tasks are deleted along with the tasks themselves).
  walkTasks(project.tasks, (t) => {
    t.dependencies = t.dependencies.filter((d) => !removed.has(d.successorId));
  });
  project.allocations = project.allocations.filter((a) => !removed.has(a.taskId));
}

export function addDependency(
  project: Project,
  predecessorId: string,
  successorId: string,
  type: DependencyType = DependencyType.FinishStart,
  difference = 0,
  hardness: DependencyHardness = "Strong",
): void {
  if (predecessorId === successorId) {
    throw new OperationError("A task cannot depend on itself");
  }
  const predecessor = findTask(project, predecessorId);
  if (!predecessor) throw new OperationError(`Task ${predecessorId} not found`);
  if (!findTask(project, successorId)) throw new OperationError(`Task ${successorId} not found`);
  if (wouldCreateCycle(project, predecessorId, successorId)) {
    throw new OperationError("Dependency would create a cycle");
  }
  const existing = predecessor.dependencies.find((d) => d.successorId === successorId);
  if (existing) {
    existing.type = type;
    existing.difference = difference;
    existing.hardness = hardness;
    return;
  }
  predecessor.dependencies.push({ successorId, type, difference, hardness });
}

export function removeDependency(
  project: Project,
  predecessorId: string,
  successorId: string,
): void {
  const predecessor = findTask(project, predecessorId);
  if (!predecessor) throw new OperationError(`Task ${predecessorId} not found`);
  predecessor.dependencies = predecessor.dependencies.filter((d) => d.successorId !== successorId);
}

/** True if adding predecessor -> successor would close a cycle in the dep graph. */
function wouldCreateCycle(project: Project, predecessorId: string, successorId: string): boolean {
  // Walk forward from `successor`; a cycle exists if we can reach `predecessor`.
  const adjacency = new Map<string, string[]>();
  walkTasks(project.tasks, (t) => {
    adjacency.set(
      t.id,
      t.dependencies.map((d) => d.successorId),
    );
  });
  const stack = [successorId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node === predecessorId) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const next of adjacency.get(node) ?? []) stack.push(next);
  }
  return false;
}

export class OperationError extends Error {
  constructor(message: string) {
    super(message);
    // Set explicitly so it survives the Durable Object RPC boundary, where
    // class identity (instanceof) is lost but `name`/`message` are preserved.
    this.name = "OperationError";
  }
}
