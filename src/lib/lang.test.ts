import { describe, it, expect } from "vitest";
import { detectLang, translationTarget, langLabel, splitMarkdownForTranslation } from "./lang";

describe("detectLang", () => {
  it("한글 위주 → ko", () => {
    expect(detectLang("# 제목\n안녕하세요. 이것은 한국어 문서입니다.")).toBe("ko");
  });
  it("영어 위주 → en", () => {
    expect(detectLang("# Title\nHello, this is an English document.")).toBe("en");
  });
  it("코드 속 영어는 무시(한국어 문서를 en으로 오판정하지 않음)", () => {
    const md = [
      "# 설치 안내",
      "다음 명령으로 설치합니다.",
      "```bash",
      "npm install some-really-long-english-package-name --save-dev",
      "```",
      "`inline code with english words here too`",
    ].join("\n");
    expect(detectLang(md)).toBe("ko");
  });
  it("빈 문자열 → en(기본)", () => {
    expect(detectLang("")).toBe("en");
  });
  it("위키링크 파일명(영문)이 많은 한글 문서 → ko (link-test-b 회귀)", () => {
    const md = [
      "# 링크 테스트 B",
      "허브로: [[link-test-hub]]",
      "A 문서로: [[link-test-a]]",
      "기존 렌더 테스트 문서로: [[render-test]]",
      "## 설명",
      "이 문서는 [[link-test-a]] 와 [[render-test]] 를 참조합니다.",
      "- **[[link-test-a]] 를 열면** 백링크에 `link-test-hub`, `link-test-b`(이 문서)가 보여야 함.",
    ].join("\n");
    expect(detectLang(md)).toBe("ko");
  });
  it("일반 마크다운 링크 URL은 무시, 표시 텍스트는 반영", () => {
    // Even with many English URLs, ko if the body text is Korean
    expect(detectLang("자세히는 [공식 문서](https://example.com/very/long/english/path) 참고")).toBe("ko");
  });
});

describe("translationTarget", () => {
  it("한국어 문서의 대상은 en", () => {
    expect(translationTarget("안녕하세요 여러분")).toBe("en");
  });
  it("영어 문서의 대상은 ko", () => {
    expect(translationTarget("Hello everyone")).toBe("ko");
  });
});

describe("langLabel", () => {
  it("라벨", () => {
    expect(langLabel("ko")).toBe("한국어");
    expect(langLabel("en")).toBe("English");
  });
});

describe("splitMarkdownForTranslation", () => {
  it("짧으면 단일 청크", () => {
    expect(splitMarkdownForTranslation("짧은 문서", 100)).toEqual(["짧은 문서"]);
  });
  it("빈 줄 경계로 나누고 각 청크는 한계 이하", () => {
    const para = (n: number) => `문단 ${n} ` + "가".repeat(40);
    const doc = [para(1), para(2), para(3), para(4)].join("\n\n");
    const chunks = splitMarkdownForTranslation(doc, 90);
    expect(chunks.length).toBeGreaterThan(1);
    // Joined back, it matches the original (separators preserved)
    expect(chunks.join("\n").replace(/\s+/g, " ").trim()).toContain("문단 4");
  });
  it("코드펜스 내부에서는 쪼개지 않는다(블록 보존)", () => {
    const code = ["```js", "const a = 1;", "", "const b = 2;", "```"].join("\n");
    const doc = ["앞 문단 " + "가".repeat(50), "", code, "", "뒤 문단 " + "나".repeat(50)].join("\n");
    const chunks = splitMarkdownForTranslation(doc, 80);
    // No chunk holds only half a code fence (the ``` count is even).
    for (const c of chunks) {
      const fences = (c.match(/```/g) ?? []).length;
      expect(fences % 2).toBe(0);
    }
  });
});
