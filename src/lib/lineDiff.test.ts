import { describe, it, expect } from "vitest";
import { lineDiff, toSideBySideRows, type DiffLine } from "./lineDiff";

// Compact view of a diff for readability in assertions: "<sign><text>".
function sigil(d: DiffLine): string {
  const s = d.type === "add" ? "+" : d.type === "remove" ? "-" : " ";
  return `${s}${d.text}`;
}
const sigils = (ds: DiffLine[]) => ds.map(sigil);

describe("lineDiff", () => {
  it("identical text → all context", () => {
    const diff = lineDiff("a\nb\nc", "a\nb\nc");
    expect(diff.every((d) => d.type === "context")).toBe(true);
    expect(sigils(diff)).toEqual([" a", " b", " c"]);
    // context lines carry both line numbers, 1-based.
    expect(diff[0]).toMatchObject({ baseLineNo: 1, otherLineNo: 1 });
    expect(diff[2]).toMatchObject({ baseLineNo: 3, otherLineNo: 3 });
  });

  it("pure additions (other has extra trailing lines)", () => {
    const diff = lineDiff("a\nb", "a\nb\nc\nd");
    expect(sigils(diff)).toEqual([" a", " b", "+c", "+d"]);
    const adds = diff.filter((d) => d.type === "add");
    expect(adds.map((d) => d.otherLineNo)).toEqual([3, 4]);
    expect(adds.every((d) => d.baseLineNo === undefined)).toBe(true);
  });

  it("pure deletions (base has extra lines)", () => {
    const diff = lineDiff("a\nb\nc\nd", "a\nb");
    expect(sigils(diff)).toEqual([" a", " b", "-c", "-d"]);
    const removes = diff.filter((d) => d.type === "remove");
    expect(removes.map((d) => d.baseLineNo)).toEqual([3, 4]);
    expect(removes.every((d) => d.otherLineNo === undefined)).toBe(true);
  });

  it("a change in the middle = remove + add of that line", () => {
    const diff = lineDiff("a\nb\nc", "a\nB\nc");
    expect(sigils(diff)).toEqual([" a", "-b", "+B", " c"]);
  });

  it("both empty → single empty context line", () => {
    const diff = lineDiff("", "");
    expect(diff).toEqual([{ type: "context", text: "", baseLineNo: 1, otherLineNo: 1 }]);
  });

  it("empty base vs non-empty other → all adds", () => {
    const diff = lineDiff("", "x\ny");
    // "" splits to a single empty line; "x\ny" has no empty line, so the empty
    // line is removed and x/y are added.
    expect(sigils(diff)).toEqual(["-", "+x", "+y"]);
  });

  it("ignores a trailing newline (no spurious final empty line)", () => {
    const diff = lineDiff("a\nb\n", "a\nb");
    expect(diff.every((d) => d.type === "context")).toBe(true);
    expect(sigils(diff)).toEqual([" a", " b"]);
  });

  it("normalizes CRLF so line endings alone aren't a diff", () => {
    const diff = lineDiff("a\r\nb\r\nc", "a\nb\nc");
    expect(diff.every((d) => d.type === "context")).toBe(true);
  });

  it("interleaved edits keep common lines as context", () => {
    const diff = lineDiff("one\ntwo\nthree\nfour", "one\n2\nthree\n4\nfive");
    expect(sigils(diff)).toEqual([
      " one",
      "-two",
      "+2",
      " three",
      "-four",
      "+4",
      "+five",
    ]);
  });
});

describe("toSideBySideRows", () => {
  // Compress each row to "<left>|<right>" (blank cells shown as ·).
  const view = (rows: ReturnType<typeof toSideBySideRows>) =>
    rows.map((r) => `${r.left ? r.left.text : "·"}|${r.right ? r.right.text : "·"}`);

  it("context → 양쪽 같은 줄", () => {
    expect(view(toSideBySideRows(lineDiff("a\nb", "a\nb")))).toEqual(["a|a", "b|b"]);
  });

  it("줄 교체 → 같은 행에 이전(왼쪽)/현재(오른쪽) 짝", () => {
    expect(view(toSideBySideRows(lineDiff("a\nb\nc", "a\nB\nc")))).toEqual(["a|a", "b|B", "c|c"]);
  });

  it("순수 추가 → 왼쪽 빈 칸", () => {
    expect(view(toSideBySideRows(lineDiff("a", "a\nb\nc")))).toEqual(["a|a", "·|b", "·|c"]);
  });

  it("순수 삭제 → 오른쪽 빈 칸", () => {
    expect(view(toSideBySideRows(lineDiff("a\nb\nc", "a")))).toEqual(["a|a", "b|·", "c|·"]);
  });

  it("삭제 수 > 추가 수 → 남는 삭제는 오른쪽 빈 칸으로", () => {
    // Hunk: remove x,y,z / add Q  → 3 rows, the shorter right side is null
    expect(view(toSideBySideRows(lineDiff("x\ny\nz", "Q")))).toEqual(["x|Q", "y|·", "z|·"]);
  });
});
