import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalStringify } from "../state/canonical";
import { buildGoldenCandidate } from "./golden-candidate";

describe.runIf(process.env.GENERATE_GOLDEN_FIXTURE === "1")("golden fixture generator", () => {
  it("writes the canonical replay package", () => {
    const output = resolve("fixtures/golden/solo-passive-v1.json");
    const candidate = buildGoldenCandidate();
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${canonicalStringify(candidate.replayPackage)}\n`, "utf8");
    expect(candidate.state.status).not.toBe("IN_PROGRESS");
  });
});
