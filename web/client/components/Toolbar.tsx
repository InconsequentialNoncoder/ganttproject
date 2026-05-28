interface ToolbarProps {
  mode: "home" | "project";
  hasProject: boolean;
  selectedId: string | null;
  linking: boolean;
  busy: boolean;
  status: string;
  projectName: string;
  exportUrl: string | null;
  onHome: () => void;
  onAddTask: () => void;
  onAddSubtask: () => void;
  onDelete: () => void;
  onToggleLink: () => void;
}

export function Toolbar(props: ToolbarProps) {
  const inProject = props.mode === "project" && props.hasProject;

  return (
    <header className="toolbar">
      <strong className="brand">GanttProject Web</strong>
      <button onClick={props.onHome}>Projects</button>

      {inProject && (
        <>
          <span className="project-name">{props.projectName || "Untitled"}</span>
          <span className="divider" />
          <button onClick={props.onAddTask}>+ Task</button>
          <button disabled={!props.selectedId} onClick={props.onAddSubtask}>
            + Subtask
          </button>
          <button
            disabled={!props.selectedId}
            className={props.linking ? "active" : ""}
            onClick={props.onToggleLink}
          >
            {props.linking ? "Linking…" : "Link"}
          </button>
          <button disabled={!props.selectedId} onClick={props.onDelete}>
            Delete
          </button>
          {props.exportUrl && (
            <a className="button" href={props.exportUrl} download="project.gan">
              Export
            </a>
          )}
        </>
      )}

      <span className="status">
        {props.busy ? "⏳ " : ""}
        {props.status}
      </span>
    </header>
  );
}
