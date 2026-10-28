import { describe, it, expect } from "vitest";
import { isMarkdownPath, isTextLikePath, isPdfPath, isHtmlPath, opensInFrame, langFromPath, buildOpenDialogFilters } from "./fileType";
import { useAppStore } from "../store/app";

describe("isMarkdownPath", () => {
  it("matches .md/.markdown (case-insensitive), POSIX·Windows 경로", () => {
    expect(isMarkdownPath("/a/b/readme.md")).toBe(true);
    expect(isMarkdownPath("C:\\docs\\Guide.MARKDOWN")).toBe(true);
  });
  it("rejects non-markdown", () => {
    expect(isMarkdownPath("/a/app.py")).toBe(false);
    expect(isMarkdownPath("/a/notes.txt")).toBe(false);
  });
});

describe("isTextLikePath", () => {
  it("코드 확장자", () => {
    for (const p of ["a.py", "a.ts", "a.tsx", "a.rs", "a.go", "a.json", "a.yml", "a.css"]) {
      expect(isTextLikePath(p)).toBe(true);
    }
  });
  it("평문 텍스트 확장자", () => {
    expect(isTextLikePath("server.log")).toBe(true);
    expect(isTextLikePath("data.csv")).toBe(true);
    expect(isTextLikePath("notes.txt")).toBe(true);
  });
  it("확장자 없는 잘 알려진 파일명·dotfile", () => {
    expect(isTextLikePath("/repo/Dockerfile")).toBe(true);
    expect(isTextLikePath("/repo/Makefile")).toBe(true);
    expect(isTextLikePath("/repo/.gitignore")).toBe(true);
  });
  it("바이너리/미지원은 false", () => {
    for (const p of ["a.png", "a.exe", "a.zip", "a.pdf", "a.woff2"]) {
      expect(isTextLikePath(p)).toBe(false);
    }
  });
});

describe("isPdfPath", () => {
  it("matches .pdf (case-insensitive), POSIX·Windows 경로", () => {
    expect(isPdfPath("/a/b/report.pdf")).toBe(true);
    expect(isPdfPath("C:\\docs\\Spec.PDF")).toBe(true);
  });
  it("PDF 아닌 건 false (텍스트·다른 바이너리)", () => {
    for (const p of ["a.md", "a.txt", "a.png", "notpdf", "a.pdf.md"]) {
      expect(isPdfPath(p)).toBe(false);
    }
  });
});

describe("isHtmlPath / opensInFrame", () => {
  it("html·htm 렌더 대상, 대소문자·Windows 경로", () => {
    expect(isHtmlPath("/a/report.html")).toBe(true);
    expect(isHtmlPath("C:\\out\\Page.HTM")).toBe(true);
    expect(isHtmlPath("a.md")).toBe(false);
  });
  it("opensInFrame = pdf 또는 html", () => {
    expect(opensInFrame("a.pdf")).toBe(true);
    expect(opensInFrame("a.html")).toBe(true);
    expect(opensInFrame("a.md")).toBe(false);
    expect(opensInFrame("a.ts")).toBe(false);
  });
});

describe("langFromPath", () => {
  it("확장자→Shiki 언어", () => {
    expect(langFromPath("a.py")).toBe("python");
    expect(langFromPath("a.ts")).toBe("typescript");
    expect(langFromPath("a.tsx")).toBe("tsx");
    expect(langFromPath("a.rs")).toBe("rust");
    expect(langFromPath("a.yml")).toBe("yaml");
    expect(langFromPath("/x/Dockerfile")).toBe("dockerfile");
  });
  it("매핑 없으면 평문(\"\")", () => {
    expect(langFromPath("a.txt")).toBe("");
    expect(langFromPath("a.log")).toBe("");
  });
});

describe("buildOpenDialogFilters", () => {
  it("마크다운·HTML 기본 + 텍스트·코드 + 모든 파일", () => {
    // Pin language to "ko" — with "system" the result depends on navigator.language
    // (the host locale), so CI/local locale differences could make the test flaky.
    useAppStore.setState((s) => ({ settings: { ...s.settings, language: "ko" } }));
    const filters = buildOpenDialogFilters();
    expect(filters[0].name).toBe("마크다운 · HTML");
    expect(filters[0].extensions).toContain("md");
    expect(filters[0].extensions).toContain("html");
    expect(filters[1].extensions).toContain("py");
    expect(filters[1].extensions).toContain("html");
    expect(filters[filters.length - 1]).toEqual({ name: "모든 파일", extensions: ["*"] });
  });
});
