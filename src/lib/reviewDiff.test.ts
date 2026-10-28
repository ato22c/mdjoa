import { describe, it, expect } from "vitest";
import { sortReviewItems, resolveBeforeAfter, baseName } from "./reviewDiff";
import type { ChangeKind } from "../types";

describe("baseName", () => {
  it("POSIX 경로에서 파일명만 뽑는다", () => {
    expect(baseName("/a/b/c.md")).toBe("c.md");
  });
  it("Windows 경로(역슬래시)도 처리한다", () => {
    expect(baseName("C:\\docs\\plan.md")).toBe("plan.md");
  });
  it("구분자 없는 입력은 그대로 반환", () => {
    expect(baseName("README.md")).toBe("README.md");
  });
});

describe("sortReviewItems", () => {
  it("종류(생성→수정) 우선, 같은 종류 안에서 이름순", () => {
    const changed: Record<string, ChangeKind> = {
      "/p/zeta.md": "modified",
      "/p/alpha.md": "created",
      "/p/beta.md": "modified",
      "/p/gamma.md": "created",
    };
    const out = sortReviewItems(changed);
    expect(out.map((i) => i.name)).toEqual([
      "alpha.md", // created
      "gamma.md", // created
      "beta.md", // modified
      "zeta.md", // modified
    ]);
  });

  it("name을 경로에서 파생하고 kind를 보존한다", () => {
    const out = sortReviewItems({ "/docs/sub/Note.md": "modified" });
    expect(out).toEqual([{ path: "/docs/sub/Note.md", name: "Note.md", kind: "modified" }]);
  });

  it("빈 맵 → 빈 배열", () => {
    expect(sortReviewItems({})).toEqual([]);
  });

  it("대소문자 무시 정렬(로캘)", () => {
    const out = sortReviewItems({ "/p/b.md": "created", "/p/A.md": "created" });
    expect(out.map((i) => i.name)).toEqual(["A.md", "b.md"]);
  });

  it("입력 맵을 변형하지 않는다", () => {
    const changed: Record<string, ChangeKind> = { "/p/a.md": "created" };
    sortReviewItems(changed);
    expect(changed).toEqual({ "/p/a.md": "created" });
  });
});

describe("resolveBeforeAfter", () => {
  it("수정: before=baseline, after=디스크", () => {
    expect(resolveBeforeAfter("modified", "old", "new")).toEqual({ before: "old", after: "new" });
  });

  it("생성: baseline 없으면 before=\"\" → 전부 추가", () => {
    expect(resolveBeforeAfter("created", undefined, "hello")).toEqual({ before: "", after: "hello" });
  });

  it("삭제: after=\"\" (baseline 유무와 무관)", () => {
    expect(resolveBeforeAfter("deleted", "was here", "anything")).toEqual({
      before: "was here",
      after: "",
    });
  });

  it("디스크를 못 읽으면(null) after=\"\"", () => {
    expect(resolveBeforeAfter("modified", "base", null)).toEqual({ before: "base", after: "" });
  });

  it("baseline도 없고 디스크도 없으면 둘 다 \"\"", () => {
    expect(resolveBeforeAfter("modified", undefined, null)).toEqual({ before: "", after: "" });
  });
});
