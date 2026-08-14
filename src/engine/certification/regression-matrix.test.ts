import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("REG1–REG22 traceability", () => {
  it("maps every normative regression exactly once to executable evidence", () => {
    const matrix = readFileSync("docs/certification/reg1-reg22-matrix.md", "utf8");
    for (let number = 1; number <= 22; number += 1) {
      const rows = matrix.match(new RegExp(`^\\| REG${number} \\|`, "gm")) ?? [];
      expect(rows, `REG${number}`).toHaveLength(1);
    }
    const referencedTests = [...matrix.matchAll(/`(src\/engine\/[^`]+\.test\.ts)`/g)].map((match) => match[1]);
    expect(referencedTests.length).toBeGreaterThan(0);
    for (const path of referencedTests) expect(existsSync(path), path).toBe(true);
  });
});
