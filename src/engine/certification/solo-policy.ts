import { actionDefinition } from "../actions/catalog";
import type { GameState, PendingDecision } from "../state/game-state";

function optionWith(decision: PendingDecision, key: string, value: string | number | boolean): string | null {
  return decision.legalOptions.find((option) => option.payload[key] === value)?.id ?? null;
}

/**
 * A deliberately conservative deterministic player used only for certification.
 * It favors non-attacking Actions and declines optional effects so hostile play
 * can drive the fixture to an unambiguous legal terminal state.
 */
export function certificationOption(state: GameState): string {
  const decision = state.pendingDecision;
  if (!decision) throw new Error("Certification policy requires a pending decision");

  if (decision.type === "CHOOSE_ACTION") {
    const ranked = decision.legalOptions
      .map((option) => ({ option, action: actionDefinition(option.payload.actionId as string) }))
      .sort((left, right) => {
        const typeRank = { SUPPORT: 0, MOVE_ACTIVATE: 1, ATTACK: 2 } as const;
        return typeRank[left.action.type] - typeRank[right.action.type] || left.action.initiative - right.action.initiative;
      });
    return ranked[0].option.id;
  }

  if (decision.type === "MOVE_MARINE") return optionWith(decision, "finish", true) ?? decision.legalOptions[0].id;
  if (decision.type === "ATTACK_MARINE") return optionWith(decision, "finish", true) ?? optionWith(decision, "declineBonus", true) ?? decision.legalOptions.at(-1)!.id;
  if (decision.type === "DOOR_TRAVEL_SLAY" || decision.type === "ATTACK_SLAY" || decision.type === "EVENT_SLAY") return optionWith(decision, "stop", true) ?? decision.legalOptions[0].id;
  if (decision.type === "DEFENSE_REROLL" || decision.type === "ATTACK_REROLL" || decision.type === "EVENT_ATTACK_REROLL") return optionWith(decision, "reroll", false) ?? decision.legalOptions[0].id;
  if (decision.type === "EVENT_ATTACK") return optionWith(decision, "finish", true) ?? decision.legalOptions.at(-1)!.id;
  if (decision.type === "EVENT_MOVEMENT_ACK") return decision.legalOptions.find((option) => option.id === "begin")?.id ?? decision.legalOptions[0].id;
  if (decision.type === "EVENT_REVEAL_ACK") return decision.legalOptions.find((option) => option.id === "begin")?.id ?? decision.legalOptions[0].id;
  if (decision.type === "TRAVEL_ANIMATION_ACK") return decision.legalOptions.find((option) => option.id === "travel")?.id ?? decision.legalOptions[0].id;
  if (decision.type === "LOCATION_ARRIVAL_ACK") return decision.legalOptions.find((option) => option.id === "begin")?.id ?? decision.legalOptions[0].id;
  if (decision.type === "GENESTEALER_ATTACK_ACK") return decision.legalOptions.find((option) => option.id === "begin")?.id ?? decision.legalOptions[0].id;
  if (decision.type === "EVENT_COUNT") return optionWith(decision, "count", 0) ?? decision.legalOptions[0].id;
  if (decision.type === "FORWARD_SCOUTING_ORDER") return optionWith(decision, "placement", "BOTTOM") ?? decision.legalOptions[0].id;
  if (decision.type === "SET_FACING" || decision.type === "APOTHECARION_FACING") return decision.legalOptions.find((option) => option.id === "keep")?.id ?? decision.legalOptions[0].id;

  const declined = optionWith(decision, "skip", true)
    ?? optionWith(decision, "attack", false)
    ?? optionWith(decision, "roll", false)
    ?? optionWith(decision, "place", false)
    ?? optionWith(decision, "spend", false);
  return declined ?? decision.legalOptions[0].id;
}
