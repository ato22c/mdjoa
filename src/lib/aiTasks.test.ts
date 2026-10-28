import { describe, it, expect } from "vitest";
import { AI_TASKS, AI_TASK_GROUPS, getTask, tasksInGroup } from "./aiTasks";

describe("aiTasks registry", () => {
  it("has the expected task ids", () => {
    expect(AI_TASKS.map((t) => t.id).sort()).toEqual([
      "improve",
      "review",
      "summarize",
      "translate-en",
      "translate-ko",
    ]);
  });

  it("every task builds a prompt wrapping the document body in markers", () => {
    for (const task of AI_TASKS) {
      const p = task.buildPrompt("HELLO_DOC_BODY");
      expect(p).toContain("===BEGIN DOCUMENT===");
      expect(p).toContain("===END DOCUMENT===");
      expect(p).toContain("HELLO_DOC_BODY");
    }
  });

  it("every task belongs to a menu group; groups cover all tasks", () => {
    // Menus (top bar, hamburger, right-click) render by group, so a task that isn't
    // in any group is shown nowhere — the whole registry must be covered by groups.
    const grouped = AI_TASK_GROUPS.flatMap((g) => tasksInGroup(g.id).map((t) => t.id));
    expect(grouped.sort()).toEqual(AI_TASKS.map((t) => t.id).sort());
    expect(tasksInGroup("translate").map((t) => t.id)).toEqual(["translate-ko", "translate-en"]);
    expect(tasksInGroup("summary").map((t) => t.id)).toEqual(["summarize", "review", "improve"]);
  });

  it("only translate tasks are chunked", () => {
    for (const t of AI_TASKS) {
      expect(Boolean(t.chunked)).toBe(t.id.startsWith("translate-"));
    }
  });

  it("review has no saveSuffix; improve/summarize/translate do", () => {
    expect(getTask("review")!.saveSuffix).toBeUndefined();
    expect(getTask("improve")!.saveSuffix).toBe("improved");
    expect(getTask("summarize")!.saveSuffix).toBe("summary");
    expect(getTask("translate-ko")!.saveSuffix).toBe("ko");
  });

  it("getTask returns undefined for an unknown id", () => {
    expect(getTask("nope")).toBeUndefined();
  });
});
