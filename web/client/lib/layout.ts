/**
 * Pure Gantt layout engine: maps the project model + computed schedule into
 * screen geometry (rows, bars, dependency arrows) and converts between pixels
 * and dates. Kept free of React/DOM so it can be unit-tested in Node.
 */
import { formatDate, parseDate } from "../../src/domain/calendar.js";
import type { ScheduledDates } from "../../src/domain/scheduler.js";
import { type Task, walkTasks } from "../../src/domain/types.js";

export const MS_PER_DAY = 86_400_000;

export interface VisibleRow {
  task: Task;
  depth: number;
  index: number;
  summary: boolean;
}

/** Flatten the task tree into display rows, honouring collapse state (`expand`). */
export function flattenVisible(tasks: Task[]): VisibleRow[] {
  const rows: VisibleRow[] = [];
  const visit = (siblings: Task[], depth: number) => {
    for (const task of siblings) {
      rows.push({ task, depth, index: rows.length, summary: task.children.length > 0 });
      if (task.children.length > 0 && task.expand !== false) {
        visit(task.children, depth + 1);
      }
    }
  };
  visit(tasks, 0);
  return rows;
}

export function diffDays(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

export function xForDate(origin: Date, date: Date, pxPerDay: number): number {
  return diffDays(origin, date) * pxPerDay;
}

/** Inverse of {@link xForDate}, snapped to a whole day and returned as ISO. */
export function dateForX(origin: Date, x: number, pxPerDay: number): string {
  const days = Math.round(x / pxPerDay);
  return formatDate(new Date(origin.getTime() + days * MS_PER_DAY));
}

export interface TimeRange {
  origin: Date;
  days: number;
}

/** Overall date span of the schedule, padded by a few days on each side. */
export function projectRange(
  schedule: Record<string, ScheduledDates>,
  padDays = 3,
): TimeRange {
  const dates = Object.values(schedule);
  if (dates.length === 0) {
    const today = parseDate(formatDate(new Date()));
    return { origin: today, days: 30 };
  }
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const d of dates) {
    min = Math.min(min, parseDate(d.start).getTime());
    max = Math.max(max, parseDate(d.end).getTime());
  }
  const origin = new Date(min - padDays * MS_PER_DAY);
  const days = Math.round((max - min) / MS_PER_DAY) + 2 * padDays;
  return { origin, days: Math.max(days, 1) };
}

export interface Bar {
  x: number;
  width: number;
  milestone: boolean;
}

/** Horizontal geometry of a task bar (vertical placement is row * rowHeight). */
export function barFor(
  dates: ScheduledDates,
  origin: Date,
  pxPerDay: number,
): Bar {
  const start = parseDate(dates.start);
  const end = parseDate(dates.end);
  const x = xForDate(origin, start, pxPerDay);
  const span = Math.max(diffDays(start, end), 0);
  return { x, width: span * pxPerDay, milestone: span === 0 };
}

export interface Point {
  x: number;
  y: number;
}

export interface DependencyArrow {
  predecessorId: string;
  successorId: string;
  points: Point[];
}

/**
 * Orthogonal finish-to-start arrows from each predecessor bar's right edge to
 * the successor bar's left edge. Only dependencies between currently visible
 * rows are emitted.
 */
export function dependencyArrows(
  rows: VisibleRow[],
  schedule: Record<string, ScheduledDates>,
  origin: Date,
  pxPerDay: number,
  rowHeight: number,
): DependencyArrow[] {
  const rowById = new Map<string, VisibleRow>();
  for (const row of rows) rowById.set(row.task.id, row);

  const arrows: DependencyArrow[] = [];
  for (const row of rows) {
    for (const dep of row.task.dependencies) {
      const successor = rowById.get(dep.successorId);
      const predDates = schedule[row.task.id];
      const succDates = schedule[dep.successorId];
      if (!successor || !predDates || !succDates) continue;

      const predBar = barFor(predDates, origin, pxPerDay);
      const succBar = barFor(succDates, origin, pxPerDay);
      const predMidY = row.index * rowHeight + rowHeight / 2;
      const succMidY = successor.index * rowHeight + rowHeight / 2;
      const startX = predBar.x + predBar.width;
      const endX = succBar.x;
      const elbowX = Math.max(startX + 8, endX - 8);

      arrows.push({
        predecessorId: row.task.id,
        successorId: dep.successorId,
        points: [
          { x: startX, y: predMidY },
          { x: elbowX, y: predMidY },
          { x: elbowX, y: succMidY },
          { x: endX, y: succMidY },
        ],
      });
    }
  }
  return arrows;
}

/** Total task count (visible or not) — handy for status displays. */
export function totalTaskCount(tasks: Task[]): number {
  let n = 0;
  walkTasks(tasks, () => n++);
  return n;
}
