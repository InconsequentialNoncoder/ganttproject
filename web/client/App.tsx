import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type ProjectView } from "./lib/api.js";
import { findTask } from "./lib/tasks.js";
import { GanttChart } from "./components/GanttChart.js";
import { Inspector } from "./components/Inspector.js";
import { Toolbar } from "./components/Toolbar.js";

const STORAGE_KEY = "gpweb.projectId";

export function App() {
  const [projectId, setProjectId] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY),
  );
  const [view, setView] = useState<ProjectView | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linkSource, setLinkSource] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    setStatus(label);
    try {
      await fn();
      setStatus("");
    } catch (err) {
      setStatus(err instanceof ApiError ? `Error: ${err.message}` : "Unexpected error");
    } finally {
      setBusy(false);
    }
  }, []);

  // Load the last project on startup.
  useEffect(() => {
    if (!projectId) return;
    run("Loading…", async () => {
      try {
        setView(await api.getProject(projectId));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          localStorage.removeItem(STORAGE_KEY);
          setProjectId(null);
        } else throw err;
      }
    });
  }, [projectId, run]);

  const adopt = (created: { id: string } & ProjectView) => {
    setProjectId(created.id);
    localStorage.setItem(STORAGE_KEY, created.id);
    setView({ project: created.project, schedule: created.schedule });
    setSelectedId(null);
    setLinkSource(null);
  };

  const newProject = () => run("Creating…", async () => adopt(await api.createProject("Untitled")));

  const importGan = (xml: string) =>
    run("Importing…", async () => adopt(await api.importProject(xml)));

  const addTask = (parentId?: string) =>
    run("Adding task…", async () => {
      if (!projectId) return;
      const next = await api.addTask(projectId, { parentId, name: "New task", duration: 1 });
      setView(next);
    });

  const updateTask = (taskId: string, patch: Record<string, unknown>) =>
    run("Saving…", async () => {
      if (!projectId) return;
      setView(await api.updateTask(projectId, taskId, patch));
    });

  const deleteTask = (taskId: string) =>
    run("Deleting…", async () => {
      if (!projectId) return;
      setView(await api.deleteTask(projectId, taskId));
      setSelectedId((cur) => (cur === taskId ? null : cur));
    });

  const removeDependency = (predecessorId: string, successorId: string) =>
    run("Removing link…", async () => {
      if (!projectId) return;
      setView(await api.removeDependency(projectId, predecessorId, successorId));
    });

  const toggleExpand = (taskId: string, expand: boolean) => updateTask(taskId, { expand });

  const rescheduleStart = (taskId: string, start: string) => updateTask(taskId, { start });

  // Linking: first click chooses the predecessor, second the successor.
  const handleLinkClick = (taskId: string) => {
    if (!linkSource) {
      setLinkSource(taskId);
      setStatus(`Linking from ${taskId}… click the successor task`);
      return;
    }
    if (linkSource === taskId) {
      setLinkSource(null);
      setStatus("");
      return;
    }
    const predecessor = linkSource;
    setLinkSource(null);
    run("Linking…", async () => {
      if (!projectId) return;
      setView(await api.addDependency(projectId, predecessor, taskId));
    });
  };

  const selected = view ? findTask(view.project.tasks, selectedId) : null;

  return (
    <div className="app">
      <Toolbar
        hasProject={!!view}
        projectId={projectId}
        selectedId={selectedId}
        linking={!!linkSource}
        busy={busy}
        status={status}
        exportUrl={projectId ? api.exportUrl(projectId) : null}
        onNew={newProject}
        onImport={importGan}
        onAddTask={() => addTask()}
        onAddSubtask={() => selectedId && addTask(selectedId)}
        onDelete={() => selectedId && deleteTask(selectedId)}
        onToggleLink={() => setLinkSource((s) => (s ? null : (selectedId ?? null)))}
      />

      {view ? (
        <div className="workspace">
          <GanttChart
            view={view}
            selectedId={selectedId}
            linkSource={linkSource}
            onSelect={setSelectedId}
            onToggleExpand={toggleExpand}
            onLinkClick={handleLinkClick}
            onRescheduleStart={rescheduleStart}
          />
          <Inspector
            task={selected}
            schedule={selected ? view.schedule[selected.id] : undefined}
            onUpdate={(patch) => selected && updateTask(selected.id, patch)}
            onDelete={() => selected && deleteTask(selected.id)}
            onRemoveDependency={removeDependency}
          />
        </div>
      ) : (
        <div className="empty">
          <p>No project open.</p>
          <button onClick={newProject}>Create a blank project</button>
          <span> or import a .gan file from the toolbar.</span>
        </div>
      )}
    </div>
  );
}
