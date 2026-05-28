import { useRef, type ChangeEvent } from "react";

interface ToolbarProps {
  hasProject: boolean;
  projectId: string | null;
  selectedId: string | null;
  linking: boolean;
  busy: boolean;
  status: string;
  exportUrl: string | null;
  onNew: () => void;
  onImport: (xml: string) => void;
  onAddTask: () => void;
  onAddSubtask: () => void;
  onDelete: () => void;
  onToggleLink: () => void;
}

export function Toolbar(props: ToolbarProps) {
  const fileInput = useRef<HTMLInputElement>(null);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) props.onImport(await file.text());
    event.target.value = "";
  };

  return (
    <header className="toolbar">
      <strong className="brand">GanttProject Web</strong>
      <button onClick={props.onNew}>New</button>
      <button onClick={() => fileInput.current?.click()}>Import .gan</button>
      <input ref={fileInput} type="file" accept=".gan,.xml" hidden onChange={onFile} />
      {props.exportUrl && (
        <a className="button" href={props.exportUrl} download="project.gan">
          Export
        </a>
      )}
      <span className="divider" />
      <button disabled={!props.hasProject} onClick={props.onAddTask}>
        + Task
      </button>
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
      <span className="status">{props.busy ? "⏳ " : ""}{props.status}</span>
    </header>
  );
}
