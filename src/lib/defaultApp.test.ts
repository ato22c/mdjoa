import { describe, it, expect } from "vitest";
import { shouldPromptDefaultApp, DEFAULT_APP_REPROMPT_MS } from "./defaultApp";

const NOW = 1_800_000_000_000;

describe("shouldPromptDefaultApp", () => {
  it("한 번도 닫은 적 없으면 묻는다", () => {
    expect(shouldPromptDefaultApp({ default_app_prompt_at: null }, NOW)).toBe(true);
  });

  it("닫은 지 30일이 안 지났으면 묻지 않는다", () => {
    const at = NOW - DEFAULT_APP_REPROMPT_MS + 1;
    expect(shouldPromptDefaultApp({ default_app_prompt_at: at }, NOW)).toBe(false);
  });

  it("정확히 30일이 지나면 다시 묻는다", () => {
    const at = NOW - DEFAULT_APP_REPROMPT_MS;
    expect(shouldPromptDefaultApp({ default_app_prompt_at: at }, NOW)).toBe(true);
  });

  it("시계가 과거로 돌아갔으면(닫은 시각이 미래) 묻지 않는다", () => {
    expect(shouldPromptDefaultApp({ default_app_prompt_at: NOW + 1000 }, NOW)).toBe(false);
  });
});
