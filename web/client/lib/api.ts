/** Typed client for the GanttProject Worker API. Same-origin (the Worker serves the SPA). */
import type { DependencyType, Project } from "../../src/domain/types.js";
import type { ScheduledDates } from "../../src/domain/scheduler.js";

export interface ProjectView {
  project: Project;
  schedule: Record<string, ScheduledDates>;
}

export interface CreatedProject extends ProjectView {
  id: string;
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status);
  }
  return (await res.json()) as T;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const api = {
  async createProject(name: string): Promise<CreatedProject> {
    return asJson(
      await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }),
    );
  },

  async importProject(xml: string): Promise<CreatedProject> {
    return asJson(await fetch("/api/projects/import", { method: "POST", body: xml }));
  },

  async getProject(id: string): Promise<ProjectView> {
    return asJson(await fetch(`/api/projects/${id}`));
  },

  exportUrl(id: string): string {
    return `/api/projects/${id}/export`;
  },

  async addTask(
    id: string,
    input: { parentId?: string; name?: string; start?: string; duration?: number },
  ): Promise<ProjectView> {
    return asJson(
      await fetch(`/api/projects/${id}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
  },

  async updateTask(
    id: string,
    taskId: string,
    patch: Record<string, unknown>,
  ): Promise<ProjectView> {
    return asJson(
      await fetch(`/api/projects/${id}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    );
  },

  async deleteTask(id: string, taskId: string): Promise<ProjectView> {
    return asJson(await fetch(`/api/projects/${id}/tasks/${taskId}`, { method: "DELETE" }));
  },

  async addDependency(
    id: string,
    predecessorId: string,
    successorId: string,
    type?: DependencyType,
  ): Promise<ProjectView> {
    return asJson(
      await fetch(`/api/projects/${id}/dependencies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ predecessorId, successorId, type }),
      }),
    );
  },

  async removeDependency(
    id: string,
    predecessorId: string,
    successorId: string,
  ): Promise<ProjectView> {
    return asJson(
      await fetch(`/api/projects/${id}/dependencies`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ predecessorId, successorId }),
      }),
    );
  },
};
