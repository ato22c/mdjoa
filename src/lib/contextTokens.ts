// Pure logic for the summed tokens + context-window gauge (feature D).
//
// The tokenizer (lib/tokenizer.ts) is a lazy-loaded BPE and heavy. Here we collect
// only "pure functions" kept separate from UI/IO:
//   - approximation (approxTokens): chars/4 heuristic for an instant interim total
//   - window ratio and overflow checks (gaugeRatio / isOverBudget)
//   - model presets (MODEL_PRESETS)
//   - stale-cancel guard (isStaleSelection)
// For the exact total, the component calls countTokensExact serially and cancellably,
// while the summation itself (sumTokens) is tested here.

/** Context-window model presets. Cost ($) estimation is intentionally left out. */
export interface ModelPreset {
  /** Display label (Korean UI) */
  label: string;
  /** Context window size in tokens */
  window: number;
}

/**
 * Offer only a few presets (minimal guard). Custom input is handled separately in the
 * UI, so it is not included here. Labels follow the Korean-UI principle.
 */
export const MODEL_PRESETS: ModelPreset[] = [
  { label: "128k", window: 128_000 },
  { label: "200k", window: 200_000 },
  { label: "1M", window: 1_000_000 },
];

/** Default context window (tokens) stored in the settings JSON. */
export const DEFAULT_CONTEXT_WINDOW = 200_000;

/** Allowed range (tokens) for a custom-entered window. Prevents unrealistic values / division by 0. */
export const MIN_CONTEXT_WINDOW = 1_000;
export const MAX_CONTEXT_WINDOW = 10_000_000;

/**
 * Approximate tokens as chars/4. Same spirit as the heuristic TopBar uses for a single
 * document, but meant to fill the summed gauge instantly "before the exact value
 * arrives". A CJK adjustment is deliberately omitted (the exact value replaces it
 * soon, so simplicity and consistency win).
 */
export function approxTokens(text: string): number {
  // Count length in code points ([...] counts a surrogate pair as 1).
  const chars = [...text].length;
  return Math.ceil(chars / 4);
}

/** Sum the tokens of several files (undefined/negative are guarded as 0). */
export function sumTokens(tokens: Array<number | undefined | null>): number {
  let total = 0;
  for (const n of tokens) {
    if (typeof n === "number" && Number.isFinite(n) && n > 0) total += n;
  }
  return total;
}

/**
 * Gauge ratio (0 and up): summed tokens relative to the window. If the window is 0 or
 * negative, return 0 to avoid division by zero. Values above 1.0 (= over budget) are
 * returned as-is (clamping happens in the display layer).
 */
export function gaugeRatio(total: number, window: number): number {
  if (!Number.isFinite(window) || window <= 0) return 0;
  const r = total / window;
  return r < 0 ? 0 : r;
}

/** Whether the window is exceeded. Exactly equal (= full) does not count as exceeded. */
export function isOverBudget(total: number, window: number): boolean {
  if (!Number.isFinite(window) || window <= 0) return false;
  return total > window;
}

/** Fill width (%) of the gauge bar. Clamped at 100% even when exceeded (the bar never overflows). */
export function gaugeFillPercent(total: number, window: number): number {
  const r = gaugeRatio(total, window);
  return Math.min(100, Math.round(r * 100));
}

/** Display percentage (integer). When exceeded, shows the actual ratio above 100. */
export function displayPercent(total: number, window: number): number {
  return Math.round(gaugeRatio(total, window) * 100);
}

/**
 * Normalize a custom-entered window value. Returns null (= invalid) for non-numbers or
 * out-of-range values so the caller keeps the previous value.
 */
export function normalizeWindow(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const v = Math.round(value);
  if (v < MIN_CONTEXT_WINDOW || v > MAX_CONTEXT_WINDOW) return null;
  return v;
}

/**
 * Stale-cancel guard. When an async summation finishes, the result must be discarded
 * if the selection changed in the meantime. Compares the selection snapshot taken when
 * the calculation started with the current selection.
 * Order-independent, duplicates ignored (set equality).
 */
export function isStaleSelection(snapshot: string[], current: string[]): boolean {
  if (snapshot.length !== current.length) return true;
  const a = new Set(snapshot);
  if (a.size !== new Set(current).size) return true;
  for (const p of current) {
    if (!a.has(p)) return true;
  }
  return false;
}
