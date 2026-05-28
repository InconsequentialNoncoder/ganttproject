import { describe, expect, it } from "vitest";
import { parseDate } from "../../src/domain/calendar.js";
import type { ScheduledDates } from "../../src/domain/scheduler.js";
import { DependencyType, type Task } from "../../src/domain/types.js";
import {
  barFor,
  dateForX,
  dependencyArrows,
  diffDays,
  flattenVisible,
  projectRange,
  xForDate,
} from "../../client/lib/layout.js";

function task(id: string, partial: Partial<Task> = {}): Task {
  return {
    id,
    uid: id,
    name: `Task ${id}`,
    meeting: false,
    start: "2024-06-03",
    duration: 1,
    complete: 0,
    expand: true,
    dependencies: [],
    customProperties: [],
    children: [],
    ...partial,
  };
}

describe("flattenVisible", () => {
  it("includes children of expanded summaries and skips collapsed ones", () => {
    const tree = [
      task("1", { children: [task("2"), task("3")] }),
      task("4", { expand: false, children: [task("5")] }),
    ];
    const rows = flattenVisible(tree);
    expect(rows.map((r) => r.task.id)).toEqual(["1", "2", "3", "4"]);
    expect(rows.find((r) => r.task.id === "2")!.depth).toBe(1);
    expect(rows.find((r) => r.task.id === "1")!.summary).toBe(true);
  });
});

describe("date <-> pixel mapping", () => {
  const origin = parseDate("2024-06-01");

  it("maps dates to x and back", () => {
    expect(diffDays(origin, parseDate("2024-06-11"))).toBe(10);
    expect(xForDate(origin, parseDate("2024-06-11"), 12)).toBe(120);
    expect(dateForX(origin, 120, 12)).toBe("2024-06-11");
  });

  it("snaps fractional pixels to the nearest day", () => {
    expect(dateForX(origin, 67, 12)).toBe(dateForX(origin, 72, 12)); // both round to day 6
  });
});

describe("projectRange", () => {
  it("spans the earliest start to the latest end with padding", () => {
    const schedule: Record<string, ScheduledDates> = {
      a: { start: "2024-06-10", end: "2024-06-15" },
      b: { start: "2024-06-05", end: "2024-06-20" },
    };
    const range = projectRange(schedule, 3);
    expect(range.origin.getTime()).toBe(parseDate("2024-06-02").getTime()); // 06-05 minus 3
    expect(range.days).toBe(diffDays(parseDate("2024-06-05"), parseDate("2024-06-20")) + 6);
  });
});

describe("barFor", () => {
  const origin = parseDate("2024-06-01");

  it("positions and sizes a task bar", () => {
    const bar = barFor({ start: "2024-06-03", end: "2024-06-10" }, origin, 10);
    expect(bar.x).toBe(20); // 2 days
    expect(bar.width).toBe(70); // 7 days
    expect(bar.milestone).toBe(false);
  });

  it("treats zero-length tasks as milestones", () => {
    const bar = barFor({ start: "2024-06-05", end: "2024-06-05" }, origin, 10);
    expect(bar.width).toBe(0);
    expect(bar.milestone).toBe(true);
  });
});

describe("dependencyArrows", () => {
  it("routes a finish-start arrow between visible rows", () => {
    const a = task("a", { dependencies: [{ successorId: "b", type: DependencyType.FinishStart, difference: 0, hardness: "Strong" }] });
    const b = task("b");
    const rows = flattenVisible([a, b]);
    const schedule: Record<string, ScheduledDates> = {
      a: { start: "2024-06-01", end: "2024-06-05" },
      b: { start: "2024-06-05", end: "2024-06-08" },
    };
    const arrows = dependencyArrows(rows, schedule, parseDate("2024-06-01"), 10, 30);
    expect(arrows.length).toBe(1);
    const arrow = arrows[0];
    expect(arrow.predecessorId).toBe("a");
    expect(arrow.successorId).toBe("b");
    // starts at predecessor bar's right edge, ends at successor bar's left edge.
    expect(arrow.points[0].x).toBe(40); // a ends day 4 -> x=40
    expect(arrow.points.at(-1)!.x).toBe(40); // b starts day 4 -> x=40
  });

  it("omits arrows to hidden (collapsed) rows", () => {
    const a = task("a", { dependencies: [{ successorId: "hidden", type: DependencyType.FinishStart, difference: 0, hardness: "Strong" }] });
    const rows = flattenVisible([a]);
    const schedule: Record<string, ScheduledDates> = { a: { start: "2024-06-01", end: "2024-06-05" } };
    expect(dependencyArrows(rows, schedule, parseDate("2024-06-01"), 10, 30)).toEqual([]);
  });
});
