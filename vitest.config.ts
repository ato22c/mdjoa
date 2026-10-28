import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose: the unit tests here are pure logic
// (no DOM, no Tauri runtime), so we skip the app's React/Tailwind plugins and
// run in a plain Node environment for speed and isolation.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // src-tauri is Rust; never let Vitest descend into it.
    exclude: ["**/node_modules/**", "**/src-tauri/**", "**/dist/**"],
  },
});
