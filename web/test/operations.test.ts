import { describe, expect, it } from "vitest";
import {
  addDependency,
  addTask,
  deleteTask,
  findTask,
  OperationError,
  removeDependency,
  updateTask,
} from "../src/domain/operations.js";
import { emptyProject } from "../src/domain/project.js";
import { applySchedule, schedule } from "../src/domain/scheduler.js";
import { DependencyType, walkTasks } from "../src/domain/types.js";

describe("task operations", () => {
  it("adds root and child tasks with generated ids", () => {
    const p = emptyProject();
    const a = addTask(p, { name: "A", start: "2024-06-03", duration: 5 });
    const child = addTask(p, { parentId: a.id, name: "A.1", start: "2024-06-03", duration: 2 });
    expect(p.tasks.length).toBe(1);
    expect(p.tasks[0].children.length).toBe(1);
    expect(child.id).not.toBe(a.id);
    expect(findTask(p, child.id)?.name).toBe("A.1");
  });

  it("updates task fields", () => {
    const p = emptyProject();
    const t = addTask(p, { name: "A" });
    updateTask(p, t.id, { name: "A renamed", duration: 9, complete: 50 });
    expect(t.name).toBe("A renamed");
    expect(t.duration).toBe(9);
    expect(t.complete).toBe(50);
  });

  it("deletes a task with its subtree and dependent edges", () => {
    const p = emptyProject();
    const a = addTask(p, { name: "A" });
    const b = addTask(p, { name: "B" });
    addDependency(p, a.id, b.id);
    deleteTask(p, b.id);
    expect(findTask(p, b.id)).toBeNull();
    expect(findTask(p, a.id)!.dependencies.length).toBe(0);
  });
});

describe("dependency operations + scheduling", () => {
  it("schedules a finish-start successor after its predecessor (across a weekend)", () => {
    const p = emptyProject();
    // Mon 2024-06-03, duration 5 working days -> ends Mon 2024-06-10.
    const a = addTask(p, { name: "A", start: "2024-06-03", duration: 5 });
    const b = addTask(p, { name: "B", start: "2024-06-03", duration: 3 });
    addDependency(p, a.id, b.id, DependencyType.FinishStart);
    const computed = schedule(p);
    expect(computed.get(b.id)!.start).toBe("2024-06-10");
  });

  it("writes the schedule back into the model", () => {
    const p = emptyProject();
    const a = addTask(p, { name: "A", start: "2024-06-03", duration: 5 });
    const b = addTask(p, { name: "B", start: "2024-06-03", duration: 3 });
    addDependency(p, a.id, b.id);
    applySchedule(p, schedule(p));
    expect(findTask(p, b.id)!.start).toBe("2024-06-10");
  });

  it("rejects self-dependencies and cycles", () => {
    const p = emptyProject();
    const a = addTask(p, { name: "A" });
    const b = addTask(p, { name: "B" });
    expect(() => addDependency(p, a.id, a.id)).toThrow(OperationError);
    addDependency(p, a.id, b.id);
    expect(() => addDependency(p, b.id, a.id)).toThrow(/cycle/);
  });

  it("removes a dependency", () => {
    const p = emptyProject();
    const a = addTask(p, { name: "A" });
    const b = addTask(p, { name: "B" });
    addDependency(p, a.id, b.id);
    removeDependency(p, a.id, b.id);
    expect(findTask(p, a.id)!.dependencies.length).toBe(0);
  });

  it("recomputes a summary parent to span its children", () => {
    const p = emptyProject();
    const parent = addTask(p, { name: "Phase", start: "2024-06-03", duration: 1 });
    addTask(p, { parentId: parent.id, name: "X", start: "2024-06-03", duration: 5 });
    addTask(p, { parentId: parent.id, name: "Y", start: "2024-06-10", duration: 5 });
    const computed = schedule(p);
    expect(computed.get(parent.id)!.start).toBe("2024-06-03");
    let yId = "";
    walkTasks(p.tasks, (t) => {
      if (t.name === "Y") yId = t.id;
    });
    expect(computed.get(parent.id)!.end).toBe(computed.get(yId)!.end);
  });
});
