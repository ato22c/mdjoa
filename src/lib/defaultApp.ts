import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { AppSettings } from "../types";

/**
 * Windows: register the app's capabilities, then open MD좋아's dedicated default-apps
 * page (where the user just clicks "기본값 설정" for .md). If registration fails or an
 * older Windows doesn't know the dedicated page, the generic default-apps screen
 * opens instead. Windows blocks silent changes (UserChoice hash protection).
 */
export async function openWindowsDefaultAppSettings(): Promise<void> {
  const registered = await invoke("register_default_app_capabilities").then(
    () => true,
    () => false
  );
  await openUrl(registered ? "ms-settings:defaultapps?registeredAppUser=MDjoa" : "ms-settings:defaultapps");
}

/** Interval before the prompt banner is shown again after being dismissed (30 days). */
export const DEFAULT_APP_REPROMPT_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Whether to consider showing the .md default-app banner (before asking the OS).
 * False if 30 days haven't passed since it was last dismissed. If the clock moved
 * backwards (now < at), the re-show interval is also treated as not yet elapsed.
 */
export function shouldPromptDefaultApp(
  s: Pick<AppSettings, "default_app_prompt_at">,
  now: number
): boolean {
  if (s.default_app_prompt_at == null) return true;
  return now - s.default_app_prompt_at >= DEFAULT_APP_REPROMPT_MS;
}
