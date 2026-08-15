import { describe, expect, it } from "vitest";
import type { PendingDecision } from "@/src/engine";
import { strategizeDestinationOption, strategizeSwarmIds } from "./strategize-selection";

const decision: PendingDecision = {
  id: "decision.10.strategize",
  type: "STRATEGIZE",
  sourceId: "action.purple.strategize",
  promptKey: "support.strategize",
  context: {},
  createdAtTransition: 10,
  legalOptions: [
    { id: "skip", label: "Skip", payload: { skip: true }, canonicalEffectPreview: null },
    { id: "move:a:0:LEFT", label: "A left", payload: { skip: false, swarmId: "a", positionIndex: 0, side: "LEFT" }, canonicalEffectPreview: null },
    { id: "move:a:1:RIGHT", label: "A right", payload: { skip: false, swarmId: "a", positionIndex: 1, side: "RIGHT" }, canonicalEffectPreview: null },
    { id: "move:b:2:LEFT", label: "B left", payload: { skip: false, swarmId: "b", positionIndex: 2, side: "LEFT" }, canonicalEffectPreview: null },
  ],
};

describe("Strategize board selection", () => {
  it("reduces exhaustive move options to unique first-step swarms", () => {
    expect(strategizeSwarmIds(decision)).toEqual(["a", "b"]);
  });

  it("resolves the second board tap to the exact canonical option", () => {
    expect(strategizeDestinationOption(decision, "a", 1, "RIGHT")?.id).toBe("move:a:1:RIGHT");
    expect(strategizeDestinationOption(decision, "a", 2, "LEFT")).toBeNull();
  });
});
