/**
 * API Worker — stateless edge router that forwards each request to the
 * Durable Object owning the addressed project.
 */
import { type NewTaskInput, type TaskPatch } from "../domain/operations.js";
import { type AddDependencyInput, type Outcome, ProjectDO } from "./projectDO.js";

export { ProjectDO };

export interface Env {
  PROJECT_DO: DurableObjectNamespace<ProjectDO>;
  ASSETS: Fetcher;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

/** Render a DO {@link Outcome}: the view on success, or the error status. */
function outcome(result: Outcome, okStatus = 200): Response {
  return result.ok ? json(result.view, okStatus) : json({ error: result.message }, result.status);
}

function stubFor(env: Env, projectId: string): DurableObjectStub<ProjectDO> {
  return env.PROJECT_DO.get(env.PROJECT_DO.idFromName(projectId));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Non-API requests are the SPA / static assets.
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      return await route(request, env);
    } catch (err) {
      // Error class identity is lost across the Durable Object RPC boundary;
      // dispatch on the preserved `name` instead of instanceof.
      if (err instanceof Error) {
        if (err.name === "ProjectNotFoundError") return json({ error: err.message }, 404);
        if (err.name === "OperationError") return json({ error: err.message }, 400);
        return json({ error: err.message }, 500);
      }
      return json({ error: "Internal error" }, 500);
    }
  },
};

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "");
  const method = request.method;
  const segments = path.split("/").filter(Boolean); // e.g. ["api","projects",":id","tasks"]

  if (segments[0] !== "api" || segments[1] !== "projects") {
    return json({ error: "Not found" }, 404);
  }

  // POST /api/projects                -> create blank ({ name })
  // POST /api/projects/import         -> create from uploaded .gan
  if (segments.length === 2 && method === "POST") {
    const id = crypto.randomUUID();
    const body = await readJson<{ name?: string }>(request);
    const result = await stubFor(env, id).initBlank(body.name ?? "");
    return result.ok ? json({ id, ...result.view }, 201) : outcome(result);
  }
  if (segments.length === 3 && segments[2] === "import" && method === "POST") {
    const id = crypto.randomUUID();
    const result = await stubFor(env, id).importGan(await request.text());
    return result.ok ? json({ id, ...result.view }, 201) : outcome(result);
  }

  const projectId = segments[2];
  if (!projectId) return json({ error: "Not found" }, 404);
  const stub = stubFor(env, projectId);

  // /api/projects/:id
  if (segments.length === 3) {
    if (method === "GET") {
      const view = await stub.getView();
      return view ? json(view) : json({ error: "Project not found" }, 404);
    }
  }

  // /api/projects/:id/export
  if (segments.length === 4 && segments[3] === "export" && method === "GET") {
    const xml = await stub.exportGan();
    if (xml === null) return json({ error: "Project not found" }, 404);
    return new Response(xml, {
      headers: { "Content-Type": "application/xml", ...CORS },
    });
  }

  // /api/projects/:id/import
  if (segments.length === 4 && segments[3] === "import" && method === "POST") {
    return outcome(await stub.importGan(await request.text()));
  }

  // /api/projects/:id/tasks
  if (segments.length === 4 && segments[3] === "tasks" && method === "POST") {
    return outcome(await stub.addTask(await readJson<NewTaskInput>(request)), 201);
  }

  // /api/projects/:id/tasks/:taskId
  if (segments.length === 5 && segments[3] === "tasks") {
    const taskId = segments[4]!;
    if (method === "PATCH") {
      return outcome(await stub.updateTask(taskId, await readJson<TaskPatch>(request)));
    }
    if (method === "DELETE") return outcome(await stub.deleteTask(taskId));
  }

  // /api/projects/:id/dependencies
  if (segments.length === 4 && segments[3] === "dependencies") {
    if (method === "POST") {
      return outcome(await stub.addDependency(await readJson<AddDependencyInput>(request)), 201);
    }
    if (method === "DELETE") {
      const body = await readJson<{ predecessorId: string; successorId: string }>(request);
      return outcome(await stub.removeDependency(body.predecessorId, body.successorId));
    }
  }

  return json({ error: "Not found" }, 404);
}

async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  const text = await request.text();
  return (text ? JSON.parse(text) : {}) as T;
}
