/**
 * API Worker — stateless edge router. Resolves the caller's session, enforces
 * per-user project ownership via the D1 index, and forwards project operations
 * to the Durable Object that owns the addressed project.
 */
import { type NewTaskInput, type TaskPatch } from "../domain/operations.js";
import { resolveSession, type Session } from "./auth.js";
import { type AddDependencyInput, type Outcome, ProjectDO } from "./projectDO.js";
import {
  deleteProject,
  ensureSchema,
  getOwner,
  insertProject,
  listProjects,
  renameProject,
  touchProject,
} from "./projects.js";

export { ProjectDO };

export interface Env {
  PROJECT_DO: DurableObjectNamespace<ProjectDO>;
  ASSETS: Fetcher;
  DB: D1Database;
  SESSION_SECRET: string;
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

function outcome(result: Outcome, okStatus = 200): Response {
  return result.ok ? json(result.view, okStatus) : json({ error: result.message }, result.status);
}

/** Attach the session cookie (when freshly minted) to an outgoing response. */
function withSession(response: Response, session: Session): Response {
  if (!session.setCookie) return response;
  const res = new Response(response.body, response);
  res.headers.append("Set-Cookie", session.setCookie);
  return res;
}

function stubFor(env: Env, projectId: string): DurableObjectStub<ProjectDO> {
  return env.PROJECT_DO.get(env.PROJECT_DO.idFromName(projectId));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const session = await resolveSession(request, env.SESSION_SECRET);
    try {
      return withSession(await route(request, env, session), session);
    } catch (err) {
      // Error class identity is lost across the Durable Object RPC boundary;
      // dispatch on the preserved `name` instead of instanceof.
      const status =
        err instanceof Error && err.name === "OperationError"
          ? 400
          : err instanceof Error && err.name === "ProjectNotFoundError"
            ? 404
            : 500;
      const message = err instanceof Error ? err.message : "Internal error";
      return withSession(json({ error: message }, status), session);
    }
  },
};

async function route(request: Request, env: Env, session: Session): Promise<Response> {
  const path = new URL(request.url).pathname.replace(/\/$/, "");
  const method = request.method;
  const segments = path.split("/").filter(Boolean); // ["api","projects",":id","tasks"]

  if (segments[0] !== "api" || segments[1] !== "projects") return json({ error: "Not found" }, 404);
  await ensureSchema(env.DB);

  // GET  /api/projects        -> list the caller's projects
  // POST /api/projects        -> create a blank project ({ name })
  if (segments.length === 2) {
    if (method === "GET") {
      return json({ projects: await listProjects(env.DB, session.userId) });
    }
    if (method === "POST") {
      const body = await readJson<{ name?: string }>(request);
      return createProject(env, session, body.name ?? "");
    }
  }

  // POST /api/projects/import -> create from an uploaded .gan
  if (segments.length === 3 && segments[2] === "import" && method === "POST") {
    const xml = await request.text();
    const id = crypto.randomUUID();
    const result = await stubFor(env, id).importGan(xml);
    if (!result.ok) return outcome(result);
    const name = result.view.project.name || "Imported project";
    await insertProject(env.DB, id, session.userId, name);
    return json({ id, ...result.view }, 201);
  }

  const projectId = segments[2];
  if (!projectId) return json({ error: "Not found" }, 404);

  // Ownership gate: hide projects the caller does not own.
  const owner = await getOwner(env.DB, projectId);
  if (owner !== session.userId) return json({ error: "Project not found" }, 404);
  const stub = stubFor(env, projectId);

  // /api/projects/:id
  if (segments.length === 3) {
    if (method === "GET") {
      const view = await stub.getView();
      return view ? json(view) : json({ error: "Project not found" }, 404);
    }
    if (method === "PATCH") {
      const body = await readJson<{ name?: string }>(request);
      const result = await stub.rename(body.name ?? "");
      if (result.ok && body.name !== undefined) await renameProject(env.DB, projectId, body.name);
      return outcome(result);
    }
    if (method === "DELETE") {
      await stub.dispose();
      await deleteProject(env.DB, projectId);
      return json({ ok: true });
    }
  }

  // /api/projects/:id/export
  if (segments.length === 4 && segments[3] === "export" && method === "GET") {
    const xml = await stub.exportGan();
    if (xml === null) return json({ error: "Project not found" }, 404);
    return new Response(xml, { headers: { "Content-Type": "application/xml", ...CORS } });
  }

  // /api/projects/:id/import (replace contents)
  if (segments.length === 4 && segments[3] === "import" && method === "POST") {
    const result = await stub.importGan(await request.text());
    if (result.ok) await renameProject(env.DB, projectId, result.view.project.name || "Project");
    return outcome(result);
  }

  // /api/projects/:id/tasks
  if (segments.length === 4 && segments[3] === "tasks" && method === "POST") {
    return touched(env, projectId, await stub.addTask(await readJson<NewTaskInput>(request)), 201);
  }

  // /api/projects/:id/tasks/:taskId
  if (segments.length === 5 && segments[3] === "tasks") {
    const taskId = segments[4]!;
    if (method === "PATCH") {
      return touched(env, projectId, await stub.updateTask(taskId, await readJson<TaskPatch>(request)));
    }
    if (method === "DELETE") return touched(env, projectId, await stub.deleteTask(taskId));
  }

  // /api/projects/:id/dependencies
  if (segments.length === 4 && segments[3] === "dependencies") {
    if (method === "POST") {
      return touched(env, projectId, await stub.addDependency(await readJson<AddDependencyInput>(request)), 201);
    }
    if (method === "DELETE") {
      const body = await readJson<{ predecessorId: string; successorId: string }>(request);
      return touched(env, projectId, await stub.removeDependency(body.predecessorId, body.successorId));
    }
  }

  return json({ error: "Not found" }, 404);
}

async function createProject(env: Env, session: Session, name: string): Promise<Response> {
  const id = crypto.randomUUID();
  const result = await stubFor(env, id).initBlank(name);
  if (!result.ok) return outcome(result);
  await insertProject(env.DB, id, session.userId, name || "Untitled");
  return json({ id, ...result.view }, 201);
}

/** Bump the project's updated_at on a successful mutation, then render it. */
async function touched(env: Env, projectId: string, result: Outcome, okStatus = 200): Promise<Response> {
  if (result.ok) await touchProject(env.DB, projectId);
  return outcome(result, okStatus);
}

async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  const text = await request.text();
  return (text ? JSON.parse(text) : {}) as T;
}
