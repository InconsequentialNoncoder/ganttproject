/**
 * D1-backed global project index: the cross-project registry of who owns which
 * project and its display name. Per-project content lives in the Durable Object;
 * this table powers the home screen list and ownership checks.
 */
export interface ProjectIndexEntry {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
}

let schemaReady = false;

export async function ensureSchema(db: D1Database): Promise<void> {
  if (schemaReady) return;
  await db.exec(
    "CREATE TABLE IF NOT EXISTS project (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  );
  await db.exec("CREATE INDEX IF NOT EXISTS idx_project_owner ON project (owner_id)");
  schemaReady = true;
}

export async function listProjects(db: D1Database, ownerId: string): Promise<ProjectIndexEntry[]> {
  const { results } = await db
    .prepare(
      "SELECT id, name, created_at, updated_at FROM project WHERE owner_id = ? ORDER BY updated_at DESC",
    )
    .bind(ownerId)
    .all<ProjectIndexEntry>();
  return results ?? [];
}

export async function insertProject(
  db: D1Database,
  id: string,
  ownerId: string,
  name: string,
): Promise<void> {
  const now = Date.now();
  await db
    .prepare("INSERT INTO project (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, ownerId, name, now, now)
    .run();
}

/** Returns the owner id of a project, or null if it does not exist. */
export async function getOwner(db: D1Database, id: string): Promise<string | null> {
  const row = await db.prepare("SELECT owner_id FROM project WHERE id = ?").bind(id).first<{
    owner_id: string;
  }>();
  return row?.owner_id ?? null;
}

export async function touchProject(db: D1Database, id: string): Promise<void> {
  await db.prepare("UPDATE project SET updated_at = ? WHERE id = ?").bind(Date.now(), id).run();
}

export async function renameProject(db: D1Database, id: string, name: string): Promise<void> {
  await db
    .prepare("UPDATE project SET name = ?, updated_at = ? WHERE id = ?")
    .bind(name, Date.now(), id)
    .run();
}

export async function deleteProject(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM project WHERE id = ?").bind(id).run();
}
