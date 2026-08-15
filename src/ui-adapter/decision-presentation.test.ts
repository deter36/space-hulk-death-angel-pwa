import { describe, expect, it } from "vitest";
import type { PendingDecision } from "@/src/engine";
import { isOffBoardMarineOption, presentedDecisionOption } from "./decision-presentation";

const rescueDecision: PendingDecision = {
  id: "decision.1096.event-marine",
  type: "EVENT_MARINE",
  sourceId: "event.rescue-space-marine.01",
  promptKey: "event.rescue",
  context: {},
  createdAtTransition: 1096,
  legalOptions: [
    { id: "marine:slain", label: "F0 · Brother Noctis", payload: { purpose: "rescue", marineId: "marine.green.brother-noctis" }, canonicalEffectPreview: null },
    { id: "marine:living", label: "Sergeant Gideon", payload: { purpose: "rescue", marineId: "marine.green.sergeant-gideon" }, canonicalEffectPreview: null },
    { id: "skip", label: "Skip this effect", payload: { purpose: "rescue", skip: true }, canonicalEffectPreview: null },
  ],
};

describe("off-board decision presentation", () => {
  it("keeps slain Marine choices in the command dock instead of treating them as board taps", () => {
    const formation = new Set(["marine.green.sergeant-gideon"]);
    expect(isOffBoardMarineOption(rescueDecision.legalOptions[0], formation)).toBe(true);
    expect(isOffBoardMarineOption(rescueDecision.legalOptions[1], formation)).toBe(false);
    expect(isOffBoardMarineOption(rescueDecision.legalOptions[2], formation)).toBe(false);
  });

  it("repairs labels and previews already serialized by an older build", () => {
    expect(presentedDecisionOption(rescueDecision, rescueDecision.legalOptions[0])).toEqual({
      label: "Brother Noctis",
      preview: "Return at the bottom of the formation facing right",
    });
  });
});
