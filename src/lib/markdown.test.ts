// @vitest-environment jsdom
//
// These tests run under jsdom because renderMarkdown's final step is
// DOMPurify.sanitize, which needs a DOM `window`. The plain `node` env (used by
// the other unit tests) has no DOM, so this single suite opts into jsdom via the
// directive above. The focus here is the KaTeX math integration and, crucially,
// that the KaTeX markup SURVIVES sanitization (output:"html" => span+class+style,
// which DOMPurify's default allowlist keeps).

import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./markdown";
import { useAppStore } from "../store/app";

// Shiki highlight is async/optional; renderMarkdown swallows its failure. We
// pass a null baseDir and light theme; only the math markup matters here.
async function render(src: string): Promise<string> {
  const { html } = await renderMarkdown(src, null, false);
  return html;
}

describe("math (KaTeX) rendering", () => {
  it("renders inline $...$ and the katex markup survives sanitization", async () => {
    const html = await render("질량-에너지: $E = mc^2$ 끝.");
    // KaTeX produced output...
    expect(html).toContain("katex");
    // ...and DOMPurify kept the class + style attributes (output:"html").
    expect(html).toMatch(/class="katex[^"]*"/);
    expect(html).toContain("style=");
    // No raw `$...$` left over in the output.
    expect(html).not.toContain("$E = mc^2$");
  });

  it("renders a block $$...$$ wrapped in .math-block", async () => {
    const html = await render("$$\n\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}\n$$");
    expect(html).toContain("math-block");
    expect(html).toContain("katex");
  });

  it("supports same-line $$ ... $$ block", async () => {
    const html = await render("$$ a^2 + b^2 = c^2 $$");
    expect(html).toContain("math-block");
    expect(html).toContain("katex");
  });

  it("does NOT treat $ inside inline code as math", async () => {
    const html = await render("가격은 `$5` 입니다.");
    // The literal text should remain inside a <code> element, not be eaten by math.
    expect(html).toContain("$5");
    expect(html).not.toContain("katex");
  });

  it("does NOT treat $ inside a fenced code block as math", async () => {
    const html = await render("```bash\necho $HOME and $PATH\n```");
    expect(html).not.toContain("katex");
  });

  it("renders a malformed formula as red error text without throwing", async () => {
    // throwOnError:false => KaTeX emits an error node colored errorColor instead
    // of throwing. The delimiter has no space after the opener so it IS parsed as
    // inline math; the TeX itself (`\frac` missing its second arg) is invalid.
    const html = await render("나쁜 수식: $\\frac{1}{$ 다음.");
    // Should not throw, and KaTeX renders the original source in red error color.
    expect(html).toContain("#cc0000");
  });

  it("leaves plain dollar amounts alone (no false math match)", async () => {
    const html = await render("It costs $5 and $10 total.");
    expect(html).not.toContain("katex");
    expect(html).toContain("$5");
  });
});

describe("code block enhancements", () => {
  it("tags ```diff added/removed lines with diff-add / diff-remove", async () => {
    const html = await render("```diff\n-old line\n+new line\n unchanged\n```");
    // Shiki may be unavailable in some test contexts; only assert when it ran.
    if (html.includes("shiki")) {
      expect(html).toContain("diff-add");
      expect(html).toContain("diff-remove");
    }
  });

  it("tags comment tokens with code-comment class (CSS applies italic + green)", async () => {
    const html = await render("```javascript\n// 주석\nconst x = 1; // 줄끝 주석\n```");
    if (html.includes("shiki")) {
      expect(html).toMatch(/class="[^"]*code-comment/);
    }
  });
});

describe("collapsible <details> sections", () => {
  it("renders <details><summary>...</summary> with markdown body parsed normally", async () => {
    const html = await render(
      "<details>\n<summary>더 보기</summary>\n\n**굵게** 본문.\n\n</details>"
    );
    expect(html).toContain("<details>");
    expect(html).toContain("<summary>더 보기</summary>");
    expect(html).toContain("<strong>굵게</strong>");
    expect(html).toContain("</details>");
  });

  it("keeps the open attribute for <details open>", async () => {
    const html = await render("<details open>\n<summary>제목</summary>\n\n내용\n\n</details>");
    expect(html).toContain("<details open");
  });

  it("still escapes unrelated angle-bracket text (html:false stays default)", async () => {
    const html = await render("Set `<your-api-key>` in the config.");
    expect(html).not.toContain("<your-api-key>");
    expect(html).toContain("&lt;your-api-key&gt;");
  });

  it("does not treat a <details> tag with extra attributes as the special form", async () => {
    const html = await render("<details onclick=\"alert(1)\">\n\ntext\n\n</details>");
    // Falls back to the pre-existing escaped-text behavior: no live tag is emitted.
    expect(html).not.toContain("<details onclick");
    expect(html).toContain("&lt;details onclick");
  });
});

describe("tables", () => {
  it("wraps the table in a scrollable div so wide tables scroll instead of squeezing", async () => {
    const html = await render("| A | B |\n| --- | --- |\n| 1 | 2 |\n");
    expect(html).toMatch(/<div class="md-table-wrap">\s*<table/);
    expect(html).toMatch(/<\/table>\s*<\/div>/);
  });
});

describe("breaks: true (single newline → <br>)", () => {
  it("turns a single newline inside a blockquote into a <br>", async () => {
    const html = await render("> 첫째 줄\n> 둘째 줄");
    expect(html).toContain("<br");
  });
});

describe("callout labels", () => {
  // The default label is looked up via t() at render time, so it now follows
  // the app's language setting instead of always being Korean. Pin the
  // setting to "ko" for this assertion and restore it afterward so other
  // tests in this file keep seeing the "system" (→ en, per jsdom) default.
  it("uses 노트 as the default label for [!note] when language is ko", async () => {
    const prevLanguage = useAppStore.getState().settings.language;
    useAppStore.getState().setSettings({ language: "ko" });
    try {
      const html = await render("> [!note]\n> 본문");
      expect(html).toContain("노트");
      expect(html).not.toContain("참고");
    } finally {
      useAppStore.getState().setSettings({ language: prevLanguage });
    }
  });
});
