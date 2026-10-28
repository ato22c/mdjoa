import { describe, it, expect, vi, beforeEach } from "vitest";

// aiTasks.ts (via the store) imports `invoke` from Tauri's core API at module
// load time. Mock it before importing anything under test, following the
// pattern in src/store/changedFiles.test.ts (the only existing precedent for
// mocking @tauri-apps/api/core in this codebase).
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import { mapLimit, runDocumentTask, cancelClaudeTask } from "./aiTasks";
import { useAppStore } from "../store/app";

describe("mapLimit", () => {
  it("returns results in original order even when later items resolve faster", async () => {
    const resolveOrder: number[] = [];
    const items = [0, 1, 2, 3];
    const results = await mapLimit(items, 2, async (item) => {
      // Item 0 is deliberately the slowest so it would finish LAST if results
      // were collected in completion order instead of input order.
      const delayMs = item === 0 ? 30 : 5;
      await new Promise((r) => setTimeout(r, delayMs));
      resolveOrder.push(item);
      return item * 10;
    });

    expect(results).toEqual([0, 10, 20, 30]);
    // Sanity check that item 0 really did resolve after at least one other
    // item, so the ordering assertion above is actually exercising the
    // order-preservation logic and not passing vacuously.
    expect(resolveOrder[0]).not.toBe(0);
  });

  it("never runs more than `limit` items concurrently", async () => {
    let active = 0;
    let maxActive = 0;
    const items = [1, 2, 3, 4, 5, 6];
    await mapLimit(items, 2, async (item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return item;
    });
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("handles an empty list", async () => {
    const results = await mapLimit([], 4, async (x) => x);
    expect(results).toEqual([]);
  });
});

// ── runDocumentTask cancellation invariant ──────────────────────────────
// The module-level `cancelled` flag in aiTasks.ts exists specifically so that
// cancelling an in-flight AI task shows exactly ONE toast (from
// cancelClaudeTask) instead of a second "실패" toast racing in from
// runDocumentTask's catch block when the killed child process's invoke
// promise settles. This is the property under test below.
describe("runDocumentTask cancellation invariant", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useAppStore.setState({
      currentFile: "/doc.md",
      currentContent: "hello world",
      translating: false,
      translateProgress: null,
      taskDoc: null,
    });
  });

  it("shows exactly one toast (the cancel toast) when cancelled mid-flight, not a duplicate failure toast", async () => {
    let rejectRunClaude!: (e: unknown) => void;
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "claude_status") {
        return Promise.resolve({ state: "system", version: "1.0.0", path: "/usr/bin/claude" });
      }
      if (cmd === "run_claude") {
        // Never settles on its own — stays "in flight" until the test
        // rejects it below, simulating the child process being killed.
        return new Promise((_, reject) => {
          rejectRunClaude = reject;
        });
      }
      if (cmd === "cancel_translate") {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });

    const showToastSpy = vi.spyOn(useAppStore.getState(), "showToast");

    const taskPromise = runDocumentTask("review");

    // Let the microtask chain (claude_status check, then the run_claude
    // invoke call) actually run before we cancel. A macrotask tick flushes
    // all pending microtasks regardless of how many awaits are in between.
    await new Promise((r) => setTimeout(r, 0));
    expect(useAppStore.getState().translating).toBe(true);

    await cancelClaudeTask();

    // Now let the in-flight run_claude call reject, as it would once the
    // killed process's invoke() rejects on the Rust side.
    rejectRunClaude(new Error("작업 실패: killed"));

    await taskPromise;

    expect(showToastSpy).toHaveBeenCalledTimes(1);
    expect(showToastSpy).toHaveBeenCalledWith("AI 작업을 취소했습니다");
  });
});
