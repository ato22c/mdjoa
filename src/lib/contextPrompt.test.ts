import { describe, it, expect } from "vitest";
import { buildContextPrompt } from "./contextPrompt";

describe("buildContextPrompt", () => {
  it("빈 목록이면 빈 문자열", () => {
    expect(buildContextPrompt([])).toBe("");
  });

  it("1개: 헤더 + 내용", () => {
    expect(buildContextPrompt([{ name: "a.md", content: "hello" }])).toBe(
      "===== a.md =====\nhello"
    );
  });

  it("여러 개: 파일 사이 빈 줄 1개로 구분", () => {
    const out = buildContextPrompt([
      { name: "a.md", content: "AAA" },
      { name: "b.md", content: "BBB" },
    ]);
    expect(out).toBe("===== a.md =====\nAAA\n\n===== b.md =====\nBBB");
  });

  it("선택 순서를 보존한다", () => {
    const out = buildContextPrompt([
      { name: "second.md", content: "2" },
      { name: "first.md", content: "1" },
    ]);
    expect(out.indexOf("second.md")).toBeLessThan(out.indexOf("first.md"));
  });

  it("내용이 깨지지 않는다(다중 줄·마크다운·특수문자 보존)", () => {
    const content = "# 제목\n\n- 항목 1\n- 항목 2\n\n```js\nconst x = 1;\n```";
    const out = buildContextPrompt([{ name: "doc.md", content }]);
    expect(out).toContain(content);
  });

  it("내용 끝의 개행 중복은 정리해 블록 간격을 일정하게 유지", () => {
    const out = buildContextPrompt([
      { name: "a.md", content: "AAA\n\n\n" },
      { name: "b.md", content: "BBB" },
    ]);
    expect(out).toBe("===== a.md =====\nAAA\n\n===== b.md =====\nBBB");
  });

  it("빈 내용 파일도 헤더는 남는다", () => {
    expect(buildContextPrompt([{ name: "empty.md", content: "" }])).toBe(
      "===== empty.md ====="
    );
  });
});
