/**
 * Forward-pass scheduler — a focused TypeScript port of the desktop engine
 * (SchedulerImpl + DependencyGraph + the dependency constraints).
 *
 * MVP scope:
 *  - Leaf tasks are scheduled As-Soon-As-Possible from their incoming
 *    dependencies; tasks without incoming dependencies stay at their stored
 *    ("anchored") start.
 *  - All four constraint types (SS/FS/FF/SF) with a lag/lead `difference`.
 *  - Summary (parent) tasks span their children: start = min(child start),
 *    end = max(child end).
 *
 * Known simplifications (acceptable for the MVP, consistent with the sample):
 *  - A dependency whose successor is a summary task is not enforced on the
 *    summary's bounds (summaries are driven by their children only).
 */
import { formatDate, parseDate, WorkingCalendar } from "./calendar.js";
import { DependencyType, type Project, type Task, walkTasks } from "./types.js";

/**
 * Write a computed schedule back into the model: every task's `start` is set to
 * its scheduled start, and summary durations are recomputed to span children.
 * This keeps a subsequent `.gan` export consistent with the schedule.
 */
export function applySchedule(project: Project, computed: Map<string, ScheduledDates>): void {
  const cal = new WorkingCalendar(project.calendar);
  walkTasks(project.tasks, (task) => {
    const dates = computed.get(task.id);
    if (!dates) return;
    task.start = dates.start;
    if (task.children.length > 0) {
      task.duration = cal.countWorkingDays(parseDate(dates.start), parseDate(dates.end));
    }
  });
}

export interface ScheduledDates {
  start: string;
  /** Exclusive finish anchor = start shifted by duration working days. */
  end: string;
}

interface Edge {
  predId: string;
  type: DependencyType;
  difference: number;
}

interface Slot {
  task: Task;
  parentId: string | null;
  isSummary: boolean;
  start: Date;
  end: Date;
}

function shift(cal: WorkingCalendar, date: Date, workingDays: number): Date {
  return workingDays >= 0
    ? cal.shiftWorkingDays(date, workingDays)
    : cal.shiftWorkingDaysBack(date, -workingDays);
}

function constraintStart(
  cal: WorkingCalendar,
  pred: Slot,
  type: DependencyType,
  difference: number,
  successorDuration: number,
): Date {
  switch (type) {
    case DependencyType.StartStart:
      return shift(cal, pred.start, difference);
    case DependencyType.FinishFinish: {
      const succEnd = shift(cal, pred.end, difference);
      return cal.shiftWorkingDaysBack(succEnd, successorDuration);
    }
    case DependencyType.StartFinish: {
      const succEnd = shift(cal, pred.start, difference);
      return cal.shiftWorkingDaysBack(succEnd, successorDuration);
    }
    case DependencyType.FinishStart:
    default:
      return shift(cal, pred.end, difference);
  }
}

/**
 * Compute the schedule for every task. Returns a map of task id -> dates.
 * The input model is not mutated.
 */
export function schedule(project: Project): Map<string, ScheduledDates> {
  const cal = new WorkingCalendar(project.calendar);

  const slots = new Map<string, Slot>();
  const order: string[] = [];
  const summariesDeepestFirst: string[] = [];

  walkTasks(project.tasks, (task, parent) => {
    const start = cal.findClosestWorkingTime(parseDate(task.start));
    slots.set(task.id, {
      task,
      parentId: parent?.id ?? null,
      isSummary: task.children.length > 0,
      start,
      end: cal.shiftWorkingDays(start, task.duration),
    });
    order.push(task.id);
    if (task.children.length > 0) summariesDeepestFirst.unshift(task.id);
  });

  // Incoming explicit dependency edges, keyed by successor id.
  const incoming = new Map<string, Edge[]>();
  walkTasks(project.tasks, (task) => {
    for (const dep of task.dependencies) {
      const list = incoming.get(dep.successorId) ?? [];
      list.push({ predId: task.id, type: dep.type, difference: dep.difference });
      incoming.set(dep.successorId, list);
    }
  });

  const maxPasses = order.length + 5;
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;

    // Leaves: As-Soon-As-Possible from incoming dependencies.
    for (const id of order) {
      const slot = slots.get(id)!;
      if (slot.isSummary) continue;
      const edges = incoming.get(id);
      let newStart = slot.start;
      if (edges && edges.length > 0) {
        let best: Date | null = null;
        for (const edge of edges) {
          const pred = slots.get(edge.predId);
          if (!pred) continue;
          const candidate = constraintStart(cal, pred, edge.type, edge.difference, slot.task.duration);
          if (best === null || candidate.getTime() > best.getTime()) best = candidate;
        }
        if (best) newStart = cal.findClosestWorkingTime(best);
      }
      if (newStart.getTime() !== slot.start.getTime()) {
        slot.start = newStart;
        slot.end = cal.shiftWorkingDays(newStart, slot.task.duration);
        changed = true;
      }
    }

    // Summaries: span children (deepest first so nested rollups settle).
    for (const id of summariesDeepestFirst) {
      const slot = slots.get(id)!;
      let minStart: Date | null = null;
      let maxEnd: Date | null = null;
      for (const child of slot.task.children) {
        const c = slots.get(child.id)!;
        if (minStart === null || c.start.getTime() < minStart.getTime()) minStart = c.start;
        if (maxEnd === null || c.end.getTime() > maxEnd.getTime()) maxEnd = c.end;
      }
      if (minStart && maxEnd) {
        if (slot.start.getTime() !== minStart.getTime() || slot.end.getTime() !== maxEnd.getTime()) {
          slot.start = minStart;
          slot.end = maxEnd;
          changed = true;
        }
      }
    }

    if (!changed) break;
  }

  const result = new Map<string, ScheduledDates>();
  for (const [id, slot] of slots) {
    result.set(id, { start: formatDate(slot.start), end: formatDate(slot.end) });
  }
  return result;
}
