/**
 * Working-time calendar: a TypeScript port of the relevant behaviour from
 * biz.ganttproject.core.calendar (WeekendCalendarImpl) and the time walkers.
 *
 * Dates are handled as UTC calendar days ("YYYY-MM-DD"); the time-of-day is
 * irrelevant for day-granularity scheduling, which is what the MVP supports.
 */
import type { Calendar } from "./types.js";

const MS_PER_DAY = 86_400_000;

export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function formatDate(date: Date): string {
  const y = date.getUTCFullYear().toString().padStart(4, "0");
  const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = date.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, n: number): Date {
  return new Date(date.getTime() + n * MS_PER_DAY);
}

/**
 * Working-time calendar derived from a project's `<calendars>` block.
 *
 * `defaultWeek` stores per-weekday flags as in `.gan`: "1" = non-working,
 * "0" = working. When absent, Saturday and Sunday default to non-working.
 */
export class WorkingCalendar {
  /** Index by JS getUTCDay() (0=Sun..6=Sat); true = working day. */
  private readonly weekdayWorking: boolean[];
  private readonly holidays: Set<string>;

  constructor(calendar?: Calendar) {
    this.weekdayWorking = WorkingCalendar.buildWeek(calendar);
    this.holidays = new Set();
    for (const h of calendar?.holidays ?? []) {
      if (h.type && h.type !== "HOLIDAY") continue;
      if (h.year) this.holidays.add(`${h.year}-${pad(h.month)}-${pad(h.date)}`);
    }
  }

  private static buildWeek(calendar?: Calendar): boolean[] {
    // Default: Mon-Fri working, weekend off.
    const working = [false, true, true, true, true, true, false];
    const dw = calendar?.defaultWeek;
    if (!dw) return working;
    const map: Record<string, number> = {
      sun: 0,
      mon: 1,
      tue: 2,
      wed: 3,
      thu: 4,
      fri: 5,
      sat: 6,
    };
    for (const [key, idx] of Object.entries(map)) {
      const flag = dw[key];
      if (flag !== undefined) working[idx] = flag === "0";
    }
    return working;
  }

  isWorkingDay(date: Date): boolean {
    if (!this.weekdayWorking[date.getUTCDay()]) return false;
    return !this.holidays.has(formatDate(date));
  }

  /** First working day on or after `date`. */
  findClosestWorkingTime(date: Date): Date {
    let d = date;
    while (!this.isWorkingDay(d)) d = addDays(d, 1);
    return d;
  }

  /**
   * Advance `count` working days from `start`, stepping over non-working days.
   * shiftWorkingDays(Mon, n) returns the n-th working day at or after start when
   * stepping forward, which is GanttProject's task end / finish-start anchor.
   */
  shiftWorkingDays(start: Date, count: number): Date {
    let d = this.findClosestWorkingTime(start);
    let remaining = count;
    while (remaining > 0) {
      d = addDays(d, 1);
      if (this.isWorkingDay(d)) remaining--;
    }
    return d;
  }

  /** Number of working-day steps from `start` to `end` (the working duration). */
  countWorkingDays(start: Date, end: Date): number {
    let d = this.findClosestWorkingTime(start);
    let n = 0;
    while (d.getTime() < end.getTime()) {
      d = addDays(d, 1);
      if (this.isWorkingDay(d)) n++;
    }
    return n;
  }

  /** Inverse of {@link shiftWorkingDays}: step `count` working days backward. */
  shiftWorkingDaysBack(end: Date, count: number): Date {
    let d = end;
    let remaining = count;
    while (remaining > 0) {
      d = addDays(d, -1);
      if (this.isWorkingDay(d)) remaining--;
    }
    return this.findClosestWorkingTime(d);
  }
}

function pad(v: string): string {
  return v.padStart(2, "0");
}
