import { useCallback } from "react";
import { useAppStore } from "../../store/app";
import { ko } from "./ko";
import { en } from "./en";
import type { Dict } from "./ko";

export type Lang = "ko" | "en";
export type { Dict };

const DICTS: Record<Lang, Dict> = { ko, en };

// 스토어를 거치지 않는 즉시 조회용 캐시. App.tsx가 언어 변경 시 갱신한다.
// t()는 스토어를 지연 조회하지만, 스토어 밖(초기 로드 전 등)에서도 안전하게 동작하도록 둔다.
let _activeLang: Lang = "ko";
export function setActiveLang(lang: Lang): void { _activeLang = lang; }
export function getActiveLang(): Lang { return _activeLang; }

/** "system" → OS 로케일(navigator.language) 기준. 그 외는 그대로. */
export function resolveLang(setting: string): Lang {
  if (setting === "ko" || setting === "en") return setting;
  const nav = typeof navigator !== "undefined" ? navigator.language : "en";
  return nav.startsWith("ko") ? "ko" : "en";
}

/** 점경로 키를 사전에서 조회. 미스면 ko로, 그것도 없으면 키 문자열(개발 중 가시). */
function lookup(lang: Lang, key: string): string {
  const walk = (root: unknown): string | null => {
    let cur: unknown = root;
    for (const p of key.split(".")) {
      if (cur && typeof cur === "object" && p in (cur as object)) {
        cur = (cur as Record<string, unknown>)[p];
      } else return null;
    }
    return typeof cur === "string" ? cur : null;
  };
  return walk(DICTS[lang]) ?? walk(DICTS.ko) ?? key;
}

export function interpolate(s: string, params?: Record<string, string | number>): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) =>
    Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : `{${k}}`,
  );
}

export function translate(lang: Lang, key: string, params?: Record<string, string | number>): string {
  return interpolate(lookup(lang, key), params);
}

// 비-React 코드(스토어 액션/lib)용. 현재 언어를 스토어에서 지연 조회.
// ponytail: store↔i18n 순환 import는 함수 본문에서만 참조 → 모듈 평가 시점 충돌 없음(무해).
export function t(key: string, params?: Record<string, string | number>): string {
  const lang = resolveLang(useAppStore.getState().settings.language);
  return translate(lang, key, params);
}

// React 훅: 언어 변경 시 해당 컴포넌트를 리렌더한다.
export function useT() {
  const lang = useAppStore((s) => resolveLang(s.settings.language));
  return useCallback(
    (key: string, params?: Record<string, string | number>) => translate(lang, key, params),
    [lang],
  );
}
