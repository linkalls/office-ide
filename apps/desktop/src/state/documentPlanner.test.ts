import { describe, expect, test } from "bun:test";
import { planDocctlCommand, planDocumentRequest, readDocctlCommand } from "./documentPlanner";

describe("document planner", () => {
  test("holds a Japanese replacement as a reviewable proposal", () => {
    const result = planDocumentRequest("「旧文」を「新文」に置換", "# Report\n\n旧文\n");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.proposal.nextSource).toContain("新文");
  });

  test("appends a paragraph without mutating before review", () => {
    const result = planDocumentRequest("「追記」を追加", "# Report\n");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.proposal.nextSource).toContain("追記");
  });

  test("turns docctl append into one reviewable document proposal", () => {
    const result = planDocctlCommand("docctl append Reviewed by finance", "# Report\n");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proposal.title).toBe("Append document paragraph");
      expect(result.proposal.nextSource).toContain("Reviewed by finance");
    }
  });

  test("replaces only the selected document text for docctl", () => {
    const result = planDocctlCommand("docctl selection replace draft", "# Report\nfinal copy\n", { start: 9, end: 14 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.proposal.nextSource).toBe("# Report\ndraft copy\n");
  });

  test("reads only the selected document text for docctl without a proposal", () => {
    const result = readDocctlCommand("docctl selection read", "# Report\nfinal copy\n", { start: 9, end: 14 });
    expect(result).toEqual({ handled: true, message: "final" });
  });

  test("returns the entire source for a docctl context request", () => {
    expect(readDocctlCommand("docctl context", "# Report\nbody\n")).toEqual({ handled: true, message: "# Report\nbody\n" });
  });
});
