/**
 * ProjectDO — the authority for a single project.
 *
 * Holds the project in a SQLite database, runs the scheduler on every change,
 * and writes the resulting schedule back into the model so exports stay
 * consistent. Being one Durable Object per project makes it the natural
 * serialization point where the Xlog real-time protocol will later attach.
 */
import { DurableObject } from "cloudflare:workers";
import { parseGan, serializeGan } from "../domain/gan.js";
import {
  addDependency,
  addTask,
  deleteTask,
  type NewTaskInput,
  OperationError,
  removeDependency,
  type TaskPatch,
  updateTask,
} from "../domain/operations.js";
import { emptyProject } from "../domain/project.js";
import { applySchedule, schedule, type ScheduledDates } from "../domain/scheduler.js";
import { DependencyType, type Project } from "../domain/types.js";
import { createSchema, hasProject, loadProject, saveProject, type SqlExecutor } from "./store.js";

export interface ProjectView {
  project: Project;
  schedule: Record<string, ScheduledDates>;
}

/**
 * Result envelope for DO methods. Errors are returned as data rather than
 * thrown, because thrown error types/names are not preserved across the
 * Durable Object RPC boundary — only structured return values cross reliably.
 */
export type Outcome =
  | { ok: true; view: ProjectView }
  | { ok: false; status: number; message: string };

export interface AddDependencyInput {
  predecessorId: string;
  successorId: string;
  type?: DependencyType;
  difference?: number;
  hardness?: "Strong" | "Rubber";
}

export class ProjectDO extends DurableObject {
  private readonly sql: SqlExecutor;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    // SqlStorage satisfies SqlExecutor structurally; the cast bridges the
    // narrower generic constraint on the platform type.
    this.sql = ctx.storage.sql as unknown as SqlExecutor;
    ctx.blockConcurrencyWhile(async () => createSchema(this.sql));
  }

  async initBlank(name: string): Promise<Outcome> {
    return this.safely(() => this.persist(emptyProject(name)));
  }

  async importGan(xml: string): Promise<Outcome> {
    return this.safely(() => {
      let project: Project;
      try {
        project = parseGan(xml);
      } catch (e) {
        throw new OperationError(`Invalid .gan file: ${(e as Error).message}`);
      }
      return this.persist(project);
    });
  }

  async getView(): Promise<ProjectView | null> {
    const project = loadProject(this.sql);
    return project ? this.toView(project) : null;
  }

  async exportGan(): Promise<string | null> {
    const project = loadProject(this.sql);
    return project ? serializeGan(project) : null;
  }

  async addTask(input: NewTaskInput): Promise<Outcome> {
    return this.mutate((project) => addTask(project, input));
  }

  async updateTask(id: string, patch: TaskPatch): Promise<Outcome> {
    return this.mutate((project) => updateTask(project, id, patch));
  }

  async deleteTask(id: string): Promise<Outcome> {
    return this.mutate((project) => deleteTask(project, id));
  }

  async addDependency(input: AddDependencyInput): Promise<Outcome> {
    return this.mutate((project) =>
      addDependency(
        project,
        input.predecessorId,
        input.successorId,
        input.type ?? DependencyType.FinishStart,
        input.difference ?? 0,
        input.hardness ?? "Strong",
      ),
    );
  }

  async removeDependency(predecessorId: string, successorId: string): Promise<Outcome> {
    return this.mutate((project) => removeDependency(project, predecessorId, successorId));
  }

  async rename(name: string): Promise<Outcome> {
    return this.mutate((project) => {
      project.name = name;
    });
  }

  /** Erase all project data so the Durable Object can be reused/garbage-collected. */
  async dispose(): Promise<void> {
    this.sql.exec("DROP TABLE IF EXISTS dependency");
    this.sql.exec("DROP TABLE IF EXISTS task");
    this.sql.exec("DROP TABLE IF EXISTS meta");
    createSchema(this.sql);
  }

  private mutate(operation: (project: Project) => void): Outcome {
    return this.safely(() => {
      if (!hasProject(this.sql)) throw new ProjectNotFoundError();
      const project = loadProject(this.sql)!;
      operation(project);
      return this.persist(project);
    });
  }

  /** Run an operation, translating known domain errors into a result envelope. */
  private safely(produce: () => ProjectView): Outcome {
    try {
      return { ok: true, view: produce() };
    } catch (err) {
      if (err instanceof ProjectNotFoundError) return { ok: false, status: 404, message: err.message };
      if (err instanceof OperationError) return { ok: false, status: 400, message: err.message };
      throw err;
    }
  }

  /** Schedule, write the schedule back, persist, and return the view. */
  private persist(project: Project): ProjectView {
    const computed = schedule(project);
    applySchedule(project, computed);
    saveProject(this.sql, project);
    return this.toView(project);
  }

  private toView(project: Project): ProjectView {
    return { project, schedule: Object.fromEntries(schedule(project)) };
  }
}

export class ProjectNotFoundError extends Error {
  constructor() {
    super("Project not found");
    this.name = "ProjectNotFoundError";
  }
}
