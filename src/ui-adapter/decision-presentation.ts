import type { PendingDecision } from "@/src/engine";

type DecisionOption = PendingDecision["legalOptions"][number];

export function isOffBoardMarineOption(option: DecisionOption, formationMarineIds: ReadonlySet<string>): boolean {
  const marineId = option.payload.marineId;
  return typeof marineId === "string" && !formationMarineIds.has(marineId);
}

export function presentedDecisionOption(decision: PendingDecision, option: DecisionOption): { label: string; preview: string | null } {
  if (decision.promptKey === "event.rescue" && typeof option.payload.marineId === "string") {
    return {
      label: option.label.replace(/^F0\s*·\s*/, ""),
      preview: option.canonicalEffectPreview ?? "Return at the bottom of the formation facing right",
    };
  }
  return { label: option.label, preview: option.canonicalEffectPreview };
}
