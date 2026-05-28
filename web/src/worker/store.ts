/**
 * Maps the {@link Project} model to/from a relational store inside a Durable
 * Object's SQLite database.
 *
 * Task tree *structure* (parent_id + position) and dependency *edges* are
 * first-class rows — this is the seam the future Xlog collaboration protocol
 * will target. Each task's scalar attributes ride along as a JSON payload so
 * the schema does not have to enumerate every `.gan` field.
 */
import {
  type DependencyHardness,
  DependencyType,
  type Project,
  type Task,
  type TaskDependency,
  walkTasks,
} from "../domain/types.js";

/** Minimal subset of Cloudflare's SqlStorage we rely on (keeps this Node-importable). */
export interface SqlExecutor {
  exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): { toArray(): T[] };
}

export function createSchema(sql: SqlExecutor): void {
  sql.exec(`CREATE TABLE IF NOT EXISTS meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    json TEXT NOT NULL
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS task (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    position INTEGER NOT NULL,
    json TEXT NOT NULL
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS dependency (
    predecessor_id TEXT NOT NULL,
    successor_id TEXT NOT NULL,
    type INTEGER NOT NULL,
    difference INTEGER NOT NULL,
    hardness TEXT NOT NULL,
    PRIMARY KEY (predecessor_id, successor_id)
  )`);
}

/** Task scalar fields persisted as JSON (everything except structure + edges). */
type TaskScalars = Omit<Task, "children" | "dependencies">;

export function hasProject(sql: SqlExecutor): boolean {
  return sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM meta").toArray()[0]!.n > 0;
}

export function saveProject(sql: SqlExecutor, project: Project): void {
  const { tasks, ...meta } = project;
  sql.exec("DELETE FROM meta");
  sql.exec("INSERT INTO meta (id, json) VALUES (1, ?)", JSON.stringify(meta));
  sql.exec("DELETE FROM task");
  sql.exec("DELETE FROM dependency");

  const insertTask = (task: Task, parentId: string | null, position: number) => {
    const { children: _children, dependencies, ...scalars } = task;
    sql.exec(
      "INSERT INTO task (id, parent_id, position, json) VALUES (?, ?, ?, ?)",
      task.id,
      parentId,
      position,
      JSON.stringify(scalars),
    );
    for (const dep of dependencies) {
      sql.exec(
        "INSERT INTO dependency (predecessor_id, successor_id, type, difference, hardness) VALUES (?, ?, ?, ?, ?)",
        task.id,
        dep.successorId,
        dep.type,
        dep.difference,
        dep.hardness,
      );
    }
  };

  const writeLevel = (siblings: Task[], parentId: string | null) => {
    siblings.forEach((task, index) => {
      insertTask(task, parentId, index);
      writeLevel(task.children, task.id);
    });
  };
  writeLevel(tasks, null);
}

interface TaskRow {
  id: string;
  parent_id: string | null;
  position: number;
  json: string;
}

interface DependencyRow {
  predecessor_id: string;
  successor_id: string;
  type: number;
  difference: number;
  hardness: string;
}

export function loadProject(sql: SqlExecutor): Project | null {
  const metaRows = sql.exec<{ json: string }>("SELECT json FROM meta WHERE id = 1").toArray();
  if (metaRows.length === 0) return null;
  const meta = JSON.parse(metaRows[0]!.json) as Omit<Project, "tasks">;

  const taskRows = sql
    .exec<TaskRow>("SELECT id, parent_id, position, json FROM task ORDER BY position")
    .toArray();

  const nodes = new Map<string, Task>();
  for (const row of taskRows) {
    const scalars = JSON.parse(row.json) as TaskScalars;
    nodes.set(row.id, { ...scalars, dependencies: [], children: [] });
  }

  const roots: Task[] = [];
  for (const row of taskRows) {
    const node = nodes.get(row.id)!;
    if (row.parent_id === null) roots.push(node);
    else nodes.get(row.parent_id)?.children.push(node);
  }

  for (const row of sql
    .exec<DependencyRow>(
      "SELECT predecessor_id, successor_id, type, difference, hardness FROM dependency",
    )
    .toArray()) {
    const predecessor = nodes.get(row.predecessor_id);
    if (!predecessor) continue;
    const dep: TaskDependency = {
      successorId: row.successor_id,
      type: row.type as DependencyType,
      difference: row.difference,
      hardness: row.hardness as DependencyHardness,
    };
    predecessor.dependencies.push(dep);
  }

  return { ...meta, tasks: roots };
}

/** Sanity helper used by tests: every dependency edge references existing tasks. */
export function listTaskIds(project: Project): string[] {
  const ids: string[] = [];
  walkTasks(project.tasks, (t) => ids.push(t.id));
  return ids;
}
