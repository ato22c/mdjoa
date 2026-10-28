// Small helper that persists each file path's "read position" (scroll px) to localStorage.
// It restores positions that used to live only in memory (a Map) across app restarts.
// It uses only frontend localStorage, without touching the backend or the store.
//
// Schema (localStorage value): JSON object — { [filePath: string]: number(scrollTop) }
//   e.g. {"/Users/me/a.md": 1280, "/Users/me/b.md": 0}
// The Map's insertion order (= most recent set order) is serialized as-is, so
// applying the cap by keeping only the last N (= most recent) behaves close to an LRU.

const STORAGE_KEY = "mdjoa.scrollPositions.v1";
// Keep only the most recent N file positions so it doesn't grow without bound.
const MAX_ENTRIES = 200;
// Debounce interval (ms) that prevents excessive localStorage writes.
const SAVE_DEBOUNCE_MS = 400;

// Parse the JSON in localStorage and restore it as a Map. If the value is missing,
// corrupted, or localStorage is unavailable (throws), return an empty Map — never throws.
export function loadScrollMemory(): Map<string, number> {
  const map = new Map<string, number>();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return map;
    const obj = JSON.parse(raw) as unknown;
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
        // Trust only finite numbers. Silently ignore anything else.
        if (typeof val === "number" && Number.isFinite(val)) {
          map.set(key, val);
        }
      }
    }
  } catch {
    // Parse failure / inaccessible → empty Map (only the read-position feature is disabled; the app is fine)
  }
  return map;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

// Serialize the Map to JSON and save it to localStorage. Debounced so it doesn't
// write on every frame while scrolling. Keeps only the most recent MAX_ENTRIES (cap).
export function saveScrollMemory(map: Map<string, number>): void {
  if (saveTimer != null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      // Rely on preserved insertion order to keep only the last (= most recent) N.
      const entries = Array.from(map.entries());
      const capped = entries.length > MAX_ENTRIES ? entries.slice(-MAX_ENTRIES) : entries;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(capped)));
    } catch {
      // Silently ignore save failures (quota exceeded / inaccessible) — retried on the next call.
    }
  }, SAVE_DEBOUNCE_MS);
}
