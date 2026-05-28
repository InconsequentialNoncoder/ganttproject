import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { api, ApiError, type ProjectSummary } from "../lib/api.js";

interface ProjectListProps {
  onOpen: (id: string) => void;
}

export function ProjectList({ onOpen }: ProjectListProps) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      setProjects(await api.listProjects());
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const create = async () => {
    const created = await api.createProject("Untitled");
    onOpen(created.id);
  };

  const importGan = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const created = await api.importProject(await file.text());
    onOpen(created.id);
  };

  const remove = async (id: string) => {
    await api.deleteProject(id);
    await refresh();
  };

  const rename = async (project: ProjectSummary) => {
    const name = prompt("Project name", project.name);
    if (name && name !== project.name) {
      await api.renameProject(project.id, name);
      await refresh();
    }
  };

  return (
    <div className="project-list">
      <div className="project-list-actions">
        <button onClick={create}>+ New project</button>
        <button onClick={() => fileInput.current?.click()}>Import .gan</button>
        <input ref={fileInput} type="file" accept=".gan,.xml" hidden onChange={importGan} />
      </div>

      {error && <p className="error">{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : projects.length === 0 ? (
        <p className="muted">No projects yet. Create one or import a .gan file.</p>
      ) : (
        <table className="projects">
          <thead>
            <tr>
              <th>Name</th>
              <th>Last modified</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td>
                  <button className="link-btn" onClick={() => onOpen(p.id)}>
                    {p.name || "Untitled"}
                  </button>
                </td>
                <td className="muted">{new Date(p.updated_at).toLocaleString()}</td>
                <td className="row-actions">
                  <button className="link-btn" onClick={() => rename(p)}>
                    rename
                  </button>
                  <button className="link-btn danger" onClick={() => remove(p.id)}>
                    delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
