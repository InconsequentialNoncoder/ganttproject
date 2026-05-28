import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatDate, parseDate, WorkingCalendar } from "../src/domain/calendar.js";
import { parseGan } from "../src/domain/gan.js";
import { schedule } from "../src/domain/scheduler.js";
import { walkTasks } from "../src/domain/types.js";

const sampleXml = readFileSync(
  fileURLToPath(new URL("../fixtures/HouseBuildingSample.gan", import.meta.url)),
  "utf8",
);

describe("WorkingCalendar", () => {
  const cal = new WorkingCalendar();

  it("treats weekends as non-working by default", () => {
    expect(cal.isWorkingDay(parseDate("2024-05-27"))).toBe(true); // Monday
    expect(cal.isWorkingDay(parseDate("2024-06-01"))).toBe(false); // Saturday
    expect(cal.isWorkingDay(parseDate("2024-06-02"))).toBe(false); // Sunday
  });

  it("shifts across weekends: 10 working days after Mon 2024-05-27 is Mon 2024-06-10", () => {
    expect(formatDate(cal.shiftWorkingDays(parseDate("2024-05-27"), 10))).toBe("2024-06-10");
  });

  it("shiftWorkingDaysBack inverts shiftWorkingDays", () => {
    const start = parseDate("2024-05-27");
    const end = cal.shiftWorkingDays(start, 15);
    expect(formatDate(cal.shiftWorkingDaysBack(end, 15))).toBe("2024-05-27");
  });
});

describe("scheduler reproduces the desktop-computed schedule", () => {
  // The .gan sample's stored start dates are output from the desktop engine,
  // so a correct port must reproduce them exactly (parity oracle).
  const project = parseGan(sampleXml);
  const computed = schedule(project);

  it("matches every stored task start date", () => {
    const mismatches: string[] = [];
    walkTasks(project.tasks, (task) => {
      const got = computed.get(task.id)!;
      const expected = formatDate(parseDate(task.start));
      if (got.start !== expected) {
        mismatches.push(`task ${task.id} (${task.name}): expected ${expected}, got ${got.start}`);
      }
    });
    expect(mismatches).toEqual([]);
  });

  it("resolves a multi-predecessor milestone to the latest constraint", () => {
    // Task 18 "Construction completed" follows task 5 "Roof" (ends 2024-09-30).
    expect(computed.get("18")!.start).toBe("2024-09-30");
  });

  it("rolls a summary up to span its children", () => {
    // Task 0 "Architectural design" spans 2024-05-27 .. end of task 17.
    expect(computed.get("0")!.start).toBe("2024-05-27");
  });
});
