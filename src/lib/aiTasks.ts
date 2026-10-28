import { invoke } from "@tauri-apps/api/core";
import { ask, save } from "@tauri-apps/plugin-dialog";
import { Languages, Sparkles, type LucideIcon } from "lucide-react";
import { useAppStore } from "../store/app";
import { baseName } from "./pathUtil";
import { splitMarkdownForTranslation } from "./lang";
import { t } from "./i18n";
import { errorMessage } from "./i18n/errorMessage";
import type { ClaudeStatus } from "../types";

// AI document task registry (SSOT). Prompt, model, and output kind are declared as data.
// Adding a task = one entry in this array. No changes to Rust, views, menus, or the store.

// Determines the buttons and scroll sync of the right-hand result pane.
//  replace  = rewrites/replaces the document (improve, translate): edit toggle, save as new file, copy; scroll sync on
//  critique = read-only findings (review): copy only; scroll sync off
//  summary  = short summary (key points): save as new file, copy; scroll sync off
export type OutputKind = "replace" | "critique" | "summary";

// Menu groups — two categories (translate/summary) shared by the top-bar popup, the
// hamburger menu, and the body right-click menu.
// Adding a group = one entry in AI_TASK_GROUPS (automatically shown in every menu).
export type AiTaskGroup = "translate" | "summary";

export const AI_TASK_GROUPS: { id: AiTaskGroup; labelKey: string; icon: LucideIcon }[] = [
  { id: "translate", labelKey: "aiTasks.groupTranslate", icon: Languages },
  { id: "summary", labelKey: "aiTasks.groupSummary", icon: Sparkles },
];

export function tasksInGroup(group: AiTaskGroup): AiTask[] {
  return AI_TASKS.filter((task) => task.group === group);
}

export interface AiTask {
  id: string;                       // stable identifier (store taskId)
  labelKey: string;                 // i18n key of the display label (menu, header, pill)
  group: AiTaskGroup;               // menu group it belongs to (translate/summary)
  model: "haiku" | "sonnet";        // per-task model (translate/summary/review: haiku is enough; improve (rewrite): sonnet)
  output: OutputKind;
  chunked?: boolean;                // true = run long documents as parallel chunks (translation only). Others use a single call
  saveSuffix?: string;              // file-name suffix for "save as new file". If absent, saving is not allowed (review)
  buildPrompt: (content: string) => string;
}

// Wrap the body in markers (same convention as translate.rs).
function doc(content: string): string {
  return `\n\n===BEGIN DOCUMENT===\n${content}\n===END DOCUMENT===`;
}

// Translation prompt (the prompt from translate.rs:218, ported to TS).
function translatePrompt(content: string, langName: string): string {
  return (
    `You are a Markdown translation engine. Translate the Markdown document delimited by the markers ` +
    `below into ${langName}. Translate only natural-language prose. Do NOT modify: fenced/inline code, URLs, link ` +
    `and image targets, HTML, YAML frontmatter keys, table structure, LaTeX math, or [[wikilink]] targets. ` +
    `Preserve all Markdown formatting, headings, and structure exactly. Output ONLY the translated Markdown — ` +
    `no explanations, no commentary, and do not wrap the whole output in a code fence.` +
    doc(content)
  );
}

export const AI_TASKS: AiTask[] = [
  {
    id: "translate-ko",
    labelKey: "aiTasks.translateKo",
    group: "translate",
    model: "haiku",
    output: "replace",
    chunked: true,
    saveSuffix: "ko",
    // eslint-disable-next-line no-restricted-syntax -- LLM prompt directive (not user-facing UI, not subject to i18n)
    buildPrompt: (c) => translatePrompt(c, "Korean (한국어)"),
  },
  {
    id: "translate-en",
    labelKey: "aiTasks.translateEn",
    group: "translate",
    model: "haiku",
    output: "replace",
    chunked: true,
    saveSuffix: "en",
    buildPrompt: (c) => translatePrompt(c, "English"),
  },
  {
    id: "summarize",
    labelKey: "aiTasks.summarize",
    group: "summary",
    model: "haiku",
    output: "summary",
    saveSuffix: "summary",
    buildPrompt: (c) =>
      // eslint-disable-next-line no-restricted-syntax -- LLM prompt directive (not user-facing UI, not subject to i18n)
      `Summarize the key points of the Markdown document delimited below. Write the summary in Korean (한국어), ` +
      `concise, capturing only the essentials. You may use Markdown bullets and headings. Output only the summary.` +
      doc(c),
  },
  {
    id: "review",
    labelKey: "aiTasks.review",
    group: "summary",
    model: "haiku",
    output: "critique",
    buildPrompt: (c) =>
      `You are a meticulous Markdown document reviewer. Review the document delimited below and report problems ` +
      // eslint-disable-next-line no-restricted-syntax -- LLM prompt directive (not user-facing UI, not subject to i18n)
      `and improvement points. Do NOT rewrite the document. Write your findings in Korean (한국어), ordered by ` +
      `priority. For each finding give a short bullet stating what is wrong, why it matters, and how to fix it. ` +
      `Use Markdown bullets and headings. Output only the review, in Korean.` +
      doc(c),
  },
  {
    id: "improve",
    labelKey: "aiTasks.improve",
    group: "summary",
    model: "sonnet",
    output: "replace",
    saveSuffix: "improved",
    buildPrompt: (c) =>
      `You are a Markdown editor. Rewrite the document delimited below to be clearer and more accurate while ` +
      `PRESERVING its meaning. Keep all Markdown structure, headings, code, links, and tables intact. Keep the ` +
      `prose in its original language (Korean stays Korean). Output ONLY the improved Markdown — no explanations, ` +
      `no commentary, and do not wrap the whole output in a code fence.` +
      doc(c),
  },
];

export function getTask(id: string): AiTask | undefined {
  return AI_TASKS.find((task) => task.id === id);
}

// ── Executor ───────────────────────────────────────────────────────────
// Cancel flag shared by all claude tasks. Kept as a single one in this module so the chunked and single paths share it.
let cancelled = false;
const TIMEOUT_MS = 180_000; // response timeout for a single call
const CONCURRENCY = 4;      // parallel chunk cap (translation)

// Check that the local claude CLI exists. If not, show an install/path guidance dialog.
export async function ensureClaude(): Promise<boolean> {
  const store = useAppStore.getState();
  let status: ClaudeStatus;
  try {
    status = await invoke<ClaudeStatus>("claude_status", { overridePath: store.settings.claude_cli_path });
  } catch {
    status = { state: "none", version: null, path: null };
  }
  if (status.state !== "none") return true;
  const openSettings = await ask(t("aiTasks.claudeNotFoundMessage"), {
    title: t("aiTasks.claudeNotFoundTitle"),
    kind: "warning",
    okLabel: t("aiTasks.openSettings"),
    cancelLabel: t("common.close"),
  }).catch(() => false);
  if (openSettings) store.setSettingsOpen(true);
  return false;
}

// Cancel the running claude task (terminates the child process). Common to chunked and single tasks.
export async function cancelClaudeTask(): Promise<void> {
  const store = useAppStore.getState();
  if (!store.translating) return;
  cancelled = true;
  await invoke("cancel_translate").catch(() => {}); // shared by all claude tasks (the command name is legacy)
  store.setTranslating(false);
  store.setTranslateProgress(null);
  store.showToast(t("aiTasks.cancelled"));
}

// Run one prompt with a timeout. The atomic unit of every task.
export async function runClaude(prompt: string, model: string): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const claudePath = useAppStore.getState().settings.claude_cli_path;
  const p = invoke<string>("run_claude", { prompt, model, claudePath });
  p.catch(() => {}); // if the timeout wins, swallow the late reject to avoid an unhandled rejection
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void invoke("cancel_translate").catch(() => {});
      reject(new Error("__timeout__"));
    }, TIMEOUT_MS);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Concurrency limit + order preservation. A small, general-purpose utility, so it is
// exported to be unit-tested directly (see aiTasks.execution.test.ts).
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

// Chunked task (translation) runner — splits a long document into chunks, runs them in parallel, and shows finished parts immediately.
async function runChunkedTask(task: AiTask, content: string): Promise<void> {
  const store = useAppStore.getState();
  const chunks = splitMarkdownForTranslation(content);
  const total = chunks.length;
  let done = 0;
  store.setTranslateProgress(total > 1 ? { cur: 0, total } : null);
  const partial: (string | null)[] = new Array(total).fill(null);
  const results = await mapLimit(chunks, CONCURRENCY, async (chunk, idx) => {
    if (cancelled) throw new Error("__cancelled__");
    const r = await runClaude(task.buildPrompt(chunk), task.model);
    partial[idx] = r;
    done += 1;
    if (!cancelled) {
      if (total > 1) store.setTranslateProgress({ cur: done, total });
      store.updateTaskContent(partial.filter((x): x is string => x !== null).join("\n\n"));
    }
    return r;
  });
  if (cancelled) return;
  // If the user closed the split or moved to a new/different document (taskDoc cleared), don't show the result.
  if (!useAppStore.getState().taskDoc) return;
  store.showTaskResult(task.id, results.join("\n\n"));
}

// Menu entry point. After the single-run guard and existence check, use the chunk runner if chunked, otherwise a single call.
export async function runDocumentTask(taskId: string): Promise<void> {
  const store = useAppStore.getState();
  const task = getTask(taskId);
  const content = store.currentContent;
  if (!task) return;
  if (!store.currentFile || !content || !content.trim()) {
    store.showToast(t("aiTasks.noDocument"));
    return;
  }
  if (store.translating) return; // single-run guard
  if (!(await ensureClaude())) return;
  // Single-call tasks send the whole document at once → length cap. Chunked (translation) sends in pieces, so it is exempt.
  if (!task.chunked && [...content].length > 28000) {
    store.showToast(t("error.translateDocTooLong"));
    return;
  }

  cancelled = false;
  store.showTaskResult(task.id, "");
  store.setTranslating(true);
  store.setTranslateProgress(null);
  try {
    if (task.chunked) {
      await runChunkedTask(task, content);
    } else {
      const out = await runClaude(task.buildPrompt(content), task.model);
      if (cancelled) return;
      // If the split is already closed (new document, close, etc.), don't revive it with the result.
      if (!useAppStore.getState().taskDoc) return;
      store.showTaskResult(task.id, out);
    }
  } catch (e) {
    if (cancelled) return; // manual cancel → no failure toast (cancelClaudeTask notifies)
    if (e instanceof Error && e.message === "__timeout__") {
      store.showToast(t("aiTasks.timeout"));
      return;
    }
    store.showToast(t("aiTasks.failed", { err: errorMessage(String(e)) }));
    await invoke("write_log", { level: "error", message: `ai task ${taskId} failed: ${e}` }).catch(() => {});
  } finally {
    if (!cancelled) {
      store.setTranslating(false);
      store.setTranslateProgress(null);
    }
  }
}

// Save the result as a new file (original preserved). Review (critique, no saveSuffix) can't be saved.
export async function saveTaskResultAsNew(): Promise<void> {
  const store = useAppStore.getState();
  const td = store.taskDoc;
  if (!td) return;
  const task = getTask(td.taskId);
  if (!task?.saveSuffix) return;
  const file = store.currentFile;
  const base = file ? baseName(file).replace(/\.(md|markdown)$/i, "") : "result";
  const out = await save({
    defaultPath: `${base}.${task.saveSuffix}.md`,
    filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
  }).catch(() => null);
  if (!out) return;
  try {
    await invoke("write_file", { path: out, content: td.content });
    store.closeTaskResult();
    await store.openFile(out);
    store.showToast(t("aiTasks.savedAsNew"));
  } catch (e) {
    store.showToast(t("aiTasks.saveFailed", { err: errorMessage(String(e)) }));
  }
}
