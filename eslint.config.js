import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Not source — build output, Rust, docs, generated, vendored.
  {
    ignores: [
      "dist",
      "src-tauri",
      "docs",
      "src/generated",
      "*.config.js",
      "scripts",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // Classic, high-signal hook rules only — the plugin's newer experimental
      // ruleset (set-state-in-effect / immutability / refs) flags legitimate,
      // intentional patterns in working code, so we don't adopt it.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // `_` is the conventional "intentionally unused" name (params, caught errors).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // Empty catch blocks are an intentional "ignore this failure" idiom here.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    // i18n 완성 가드: 사용자 노출 경로에 한글 문자열 리터럴/JSX 텍스트가 남으면 에러.
    // AST 기반이라 주석의 한글은 무시된다. 스윕 완료(38개 파일) 후 "warn"→"error"로 승격됨
    // — 이제 영구 CI 게이트. 회귀 발생 시 lint가 하드 실패한다.
    // ponytail: 휴리스틱 — 사전 파일/테스트/문서번역 로직은 ignores로 제외. 코드행 끝 주석의
    //           한글은 잡힐 수 있음(그 경우 해당 라인만 eslint-disable-next-line).
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/lib/i18n/**",       // 사전 자체
      "src/lib/lang.ts",       // 문서 언어 감지 휴리스틱(한글 판별용, UI 아님)
      "**/*.test.ts",
      "**/*.test.tsx",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "Literal[value=/[\\uAC00-\\uD7A3]/]", message: "사용자 문자열은 t()/useT()로. 한글 리터럴 금지(i18n)." },
        { selector: "TemplateElement[value.raw=/[\\uAC00-\\uD7A3]/]", message: "사용자 문자열은 t()/useT()로. 한글 템플릿 금지(i18n)." },
        { selector: "JSXText[value=/[\\uAC00-\\uD7A3]/]", message: "사용자 문자열은 t()/useT()로. JSX 한글 텍스트 금지(i18n)." },
      ],
    },
  }
);
