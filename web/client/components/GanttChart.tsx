import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { formatDate } from "../../src/domain/calendar.js";
import type { ProjectView } from "../lib/api.js";
import {
  barFor,
  dateForX,
  dependencyArrows,
  flattenVisible,
  MS_PER_DAY,
  projectRange,
} from "../lib/layout.js";

const ROW_HEIGHT = 30;
const BAR_HEIGHT = 16;
const PX_PER_DAY = 22;

interface GanttChartProps {
  view: ProjectView;
  selectedId: string | null;
  linkSource: string | null;
  onSelect: (id: string) => void;
  onToggleExpand: (id: string, expand: boolean) => void;
  onLinkClick: (id: string) => void;
  onRescheduleStart: (id: string, start: string) => void;
}

interface DragState {
  id: string;
  baseX: number;
  startClientX: number;
  dx: number;
}

export function GanttChart(props: GanttChartProps) {
  const { view, selectedId, linkSource, onSelect, onToggleExpand, onLinkClick } = props;
  const rows = flattenVisible(view.project.tasks);
  const range = projectRange(view.schedule);
  const linking = linkSource !== null;

  const svgWidth = range.days * PX_PER_DAY;
  const svgHeight = Math.max(rows.length * ROW_HEIGHT, ROW_HEIGHT);

  const [drag, setDrag] = useState<DragState | null>(null);

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) =>
      setDrag((d) => (d ? { ...d, dx: e.clientX - d.startClientX } : d));
    const up = () => {
      setDrag((d) => {
        if (d) {
          const newStart = dateForX(range.origin, d.baseX + d.dx, PX_PER_DAY);
          if (newStart !== view.schedule[d.id]?.start) props.onRescheduleStart(d.id, newStart);
        }
        return null;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, range.origin, view.schedule, props]);

  const arrows = dependencyArrows(rows, view.schedule, range.origin, PX_PER_DAY, ROW_HEIGHT);

  // Weekly gridlines + header labels.
  const weeks: { x: number; label: string }[] = [];
  for (let day = 0; day <= range.days; day += 7) {
    const date = new Date(range.origin.getTime() + day * MS_PER_DAY);
    weeks.push({ x: day * PX_PER_DAY, label: formatDate(date).slice(5) });
  }

  // Weekend shading columns.
  const weekends: number[] = [];
  for (let day = 0; day < range.days; day++) {
    const dow = new Date(range.origin.getTime() + day * MS_PER_DAY).getUTCDay();
    if (dow === 0 || dow === 6) weekends.push(day * PX_PER_DAY);
  }

  return (
    <div className="gantt">
      <div className="tree-table">
        <div className="tree-header" style={{ height: ROW_HEIGHT }}>
          <span className="col-name">Name</span>
          <span className="col-date">Start</span>
          <span className="col-date">End</span>
          <span className="col-dur">Days</span>
        </div>
        {rows.map((row) => {
          const dates = view.schedule[row.task.id];
          return (
            <div
              key={row.task.id}
              className={`tree-row${selectedId === row.task.id ? " selected" : ""}`}
              style={{ height: ROW_HEIGHT }}
              onClick={() => onSelect(row.task.id)}
            >
              <span className="col-name" style={{ paddingLeft: 6 + row.depth * 16 }}>
                {row.summary && (
                  <button
                    className="twisty"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleExpand(row.task.id, row.task.expand === false);
                    }}
                  >
                    {row.task.expand === false ? "▶" : "▼"}
                  </button>
                )}
                {row.task.meeting ? "◆ " : ""}
                {row.task.name}
              </span>
              <span className="col-date">{dates?.start ?? row.task.start}</span>
              <span className="col-date">{dates?.end ?? ""}</span>
              <span className="col-dur">{row.task.duration}</span>
            </div>
          );
        })}
      </div>

      <div className="timeline">
        <svg width={svgWidth} height={svgHeight + ROW_HEIGHT} className="timeline-svg">
          <defs>
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="#888" />
            </marker>
          </defs>

          {weekends.map((x) => (
            <rect key={`we${x}`} x={x} y={ROW_HEIGHT} width={PX_PER_DAY} height={svgHeight} className="weekend" />
          ))}

          <g className="grid">
            {weeks.map((w) => (
              <g key={`wk${w.x}`}>
                <line x1={w.x} y1={ROW_HEIGHT} x2={w.x} y2={svgHeight + ROW_HEIGHT} className="gridline" />
                <text x={w.x + 3} y={ROW_HEIGHT - 10} className="tick">
                  {w.label}
                </text>
              </g>
            ))}
          </g>

          <g className="arrows">
            {arrows.map((a) => (
              <polyline
                key={`${a.predecessorId}-${a.successorId}`}
                points={a.points.map((p) => `${p.x},${p.y + ROW_HEIGHT}`).join(" ")}
                className="arrow"
                markerEnd="url(#arrow)"
              />
            ))}
          </g>

          {rows.map((row) => {
            const dates = view.schedule[row.task.id];
            if (!dates) return null;
            const bar = barFor(dates, range.origin, PX_PER_DAY);
            const dx = drag?.id === row.task.id ? drag.dx : 0;
            const y = row.index * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2 + ROW_HEIGHT;
            const midY = row.index * ROW_HEIGHT + ROW_HEIGHT / 2 + ROW_HEIGHT;
            const selectedCls = selectedId === row.task.id ? " selected" : "";
            const sourceCls = linkSource === row.task.id ? " link-source" : "";

            const onPointerDown = (e: ReactPointerEvent) => {
              onSelect(row.task.id);
              if (linking) {
                onLinkClick(row.task.id);
                return;
              }
              if (row.summary) return; // summaries are derived; not draggable
              setDrag({ id: row.task.id, baseX: bar.x, startClientX: e.clientX, dx: 0 });
            };

            if (bar.milestone) {
              const cx = bar.x + dx;
              return (
                <g key={row.task.id} onPointerDown={onPointerDown} className="bar-group">
                  <path
                    d={`M${cx},${midY - 8} L${cx + 8},${midY} L${cx},${midY + 8} L${cx - 8},${midY} Z`}
                    className={`milestone${selectedCls}${sourceCls}`}
                  />
                </g>
              );
            }

            const completeWidth = (bar.width * Math.min(Math.max(row.task.complete, 0), 100)) / 100;
            return (
              <g key={row.task.id} onPointerDown={onPointerDown} className="bar-group">
                <rect
                  x={bar.x + dx}
                  y={y}
                  width={bar.width}
                  height={BAR_HEIGHT}
                  rx={3}
                  className={`bar${row.summary ? " summary" : ""}${selectedCls}${sourceCls}`}
                  style={row.task.color && !row.summary ? { fill: row.task.color } : undefined}
                />
                {completeWidth > 0 && !row.summary && (
                  <rect x={bar.x + dx} y={y + BAR_HEIGHT - 4} width={completeWidth} height={4} className="progress" />
                )}
                <text x={bar.x + dx + bar.width + 6} y={midY + 4} className="bar-label">
                  {row.task.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
