import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseGan, serializeGan } from "../src/domain/gan.js";
import { DependencyType, walkTasks, type Task } from "../src/domain/types.js";

const sampleXml = readFileSync(
  fileURLToPath(new URL("../fixtures/HouseBuildingSample.gan", import.meta.url)),
  "utf8",
);

function flatten(tasks: Task[]): Task[] {
  const out: Task[] = [];
  walkTasks(tasks, (t) => out.push(t));
  return out;
}

describe("parseGan extracts known values from a real document", () => {
  const project = parseGan(sampleXml);

  it("reads project-level metadata", () => {
    expect(project.version).toBe("3.3.3309");
    expect(project.locale).toBe("en");
    expect(project.viewDate).toBe("2024-05-19");
  });

  it("reads the full task hierarchy", () => {
    // Sample has 5 top-level tasks; 20 tasks in total.
    expect(project.tasks.length).toBe(5);
    expect(flatten(project.tasks).length).toBe(20);
  });

  it("reads nested tasks, dates and completion", () => {
    const root = project.tasks[0];
    expect(root.name).toBe("Architectural design");
    expect(root.children.length).toBe(3);
    const draft = root.children[0];
    expect(draft.name).toBe("Create draft of architecture");
    expect(draft.start).toBe("2024-05-27");
    expect(draft.duration).toBe(10);
    expect(draft.complete).toBe(100);
  });

  it("reads dependencies with type and hardness", () => {
    const draft = project.tasks[0].children[0];
    expect(draft.dependencies.length).toBe(2);
    const dep = draft.dependencies[0];
    expect(dep.successorId).toBe("10");
    expect(dep.type).toBe(DependencyType.FinishStart);
    expect(dep.hardness).toBe("Strong");
  });

  it("reads milestones", () => {
    const milestone = flatten(project.tasks).find((t) => t.id === "17");
    expect(milestone?.meeting).toBe(true);
    expect(milestone?.duration).toBe(0);
  });

  it("reads resources with rates", () => {
    expect(project.resources.length).toBe(7);
    const john = project.resources.find((r) => r.name === "John Black");
    expect(john?.rate?.value).toBe("40");
  });

  it("reads allocations", () => {
    expect(project.allocations.length).toBe(30);
    const first = project.allocations[0];
    expect(first.taskId).toBe("9");
    expect(first.load).toBe(50);
  });

  it("reads the calendar holiday and roles", () => {
    expect(project.calendar.holidays.length).toBe(1);
    expect(project.calendar.holidays[0].type).toBe("HOLIDAY");
    const named = project.roleSets.find((rs) => rs.roles.length > 0);
    expect(named?.roles.length).toBe(6);
  });

  it("reads task notes (CDATA)", () => {
    const equipment = flatten(project.tasks).find((t) => t.id === "14");
    expect(equipment?.notes).toContain("Embedded devices");
  });
});

describe("serializeGan round-trips through the model", () => {
  it("is idempotent: parse -> serialize -> parse yields an equal model", () => {
    const a = parseGan(sampleXml);
    const xml2 = serializeGan(a);
    const b = parseGan(xml2);
    expect(b).toEqual(a);
  });

  it("produces valid, re-parseable XML", () => {
    const xml2 = serializeGan(parseGan(sampleXml));
    expect(xml2.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml2).toContain("<project");
    expect(() => parseGan(xml2)).not.toThrow();
  });
});
