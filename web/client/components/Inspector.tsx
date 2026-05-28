import { useEffect, useState } from "react";
import type { ScheduledDates } from "../../src/domain/scheduler.js";
import type { Task } from "../../src/domain/types.js";

interface InspectorProps {
  task: Task | null;
  schedule?: ScheduledDates;
  onUpdate: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
  onRemoveDependency: (predecessorId: string, successorId: string) => void;
}

export function Inspector({ task, schedule, onUpdate, onDelete, onRemoveDependency }: InspectorProps) {
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [duration, setDuration] = useState(1);
  const [complete, setComplete] = useState(0);
  const [meeting, setMeeting] = useState(false);

  // Reset the form when the selected task changes.
  useEffect(() => {
    if (!task) return;
    setName(task.name);
    setStart(task.start);
    setDuration(task.duration);
    setComplete(task.complete);
    setMeeting(task.meeting);
  }, [task]);

  if (!task) {
    return (
      <aside className="inspector empty-inspector">
        <p>Select a task to edit its details.</p>
      </aside>
    );
  }

  const isSummary = task.children.length > 0;

  return (
    <aside className="inspector">
      <h2>Task {task.id}</h2>
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => onUpdate({ name })} />
      </label>
      <label>
        Start
        <input
          type="date"
          value={start}
          disabled={isSummary}
          onChange={(e) => setStart(e.target.value)}
          onBlur={() => onUpdate({ start })}
        />
      </label>
      <label>
        Duration (working days)
        <input
          type="number"
          min={0}
          value={duration}
          disabled={isSummary}
          onChange={(e) => setDuration(Number(e.target.value))}
          onBlur={() => onUpdate({ duration })}
        />
      </label>
      <label>
        Completion %
        <input
          type="number"
          min={0}
          max={100}
          value={complete}
          onChange={(e) => setComplete(Number(e.target.value))}
          onBlur={() => onUpdate({ complete })}
        />
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={meeting}
          onChange={(e) => {
            setMeeting(e.target.checked);
            onUpdate({ meeting: e.target.checked });
          }}
        />
        Milestone
      </label>

      {schedule && (
        <p className="scheduled">
          Scheduled: {schedule.start} → {schedule.end}
          {isSummary && " (rolled up from children)"}
        </p>
      )}

      {task.dependencies.length > 0 && (
        <div className="deps">
          <h3>Successors</h3>
          <ul>
            {task.dependencies.map((d) => (
              <li key={d.successorId}>
                → Task {d.successorId}
                <button className="link-btn" onClick={() => onRemoveDependency(task.id, d.successorId)}>
                  remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button className="danger" onClick={onDelete}>
        Delete task
      </button>
    </aside>
  );
}
