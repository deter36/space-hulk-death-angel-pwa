import type { Side } from "@/src/data/types";
import type { GameState, PendingDecision } from "../state/game-state";
import { EVENTS, MARINES } from "./catalog";
import { makeDecision } from "./support";

export function stealthFirstDecision(state: GameState, actionId: string): PendingDecision | null {
  const available = (["LEFT", "RIGHT"] as Side[]).filter((side) => state.orderedSources[side === "LEFT" ? "blip.left" : "blip.right"].length > 0);
  if (!available.length) return null;
  return makeDecision(state, "STEALTH_FIRST", actionId, "move.stealthFirst", [
    { id: "skip", label: "Do not discard a Blip card", payload: { skip: true }, canonicalEffectPreview: null },
    ...available.map((side) => ({ id: `side:${side}`, label: `Discard the top ${side} Blip card`, payload: { skip: false, side }, canonicalEffectPreview: `Discard 1 card from the ${side} Blip` })),
  ]);
}

export function stealthSecondDecision(state: GameState, actionId: string, side: Side): PendingDecision | null {
  const source = side === "LEFT" ? "blip.left" : "blip.right";
  if (!state.orderedSources[source].length) return null;
  const holders = state.formation.map((slot) => slot.marineInstanceId).filter((id) => state.marines[id].support > 0);
  if (!holders.length) return null;
  return makeDecision(state, "STEALTH_SECOND", actionId, "move.stealthSecond", [
    { id: "skip", label: "Do not spend Support", payload: { skip: true }, canonicalEffectPreview: null },
    ...holders.map((marineId) => ({
      id: `spend:${marineId}`,
      label: `Spend 1 Support from ${MARINES.find((marine) => marine.id === state.components[marineId].definitionId)?.name ?? marineId}`,
      payload: { skip: false, marineId, side },
      canonicalEffectPreview: `Discard 1 card from the ${side} Blip`,
    })),
  ]);
}

export function forwardScoutingDecision(state: GameState, actionId: string, eventCardId: string): PendingDecision {
  const name = EVENTS.find((event) => event.id === state.components[eventCardId].definitionId)?.name ?? eventCardId;
  return makeDecision(state, "FORWARD_SCOUTING_ORDER", actionId, "move.forwardScouting", [
    { id: "top", label: `Keep ${name} on top`, payload: { placement: "TOP", eventCardId }, canonicalEffectPreview: `${name} remains next` },
    { id: "bottom", label: `Place ${name} on the bottom`, payload: { placement: "BOTTOM", eventCardId }, canonicalEffectPreview: `${name} moves to the bottom` },
  ]);
}

export function intimidationRollDecision(state: GameState, actionId: string): PendingDecision {
  return makeDecision(state, "INTIMIDATION_ROLL", actionId, "move.intimidationRoll", [
    { id: "skip", label: "Do not use Intimidation", payload: { roll: false }, canonicalEffectPreview: null },
    { id: "roll", label: "Roll for Intimidation", payload: { roll: true }, canonicalEffectPreview: "Roll the combat die" },
  ]);
}

export function intimidationEligibleCards(state: GameState): string[] {
  const bluePositions = new Set(state.teams.BLUE.marineInstanceIds.filter((id) => state.marines[id]).map((id) => state.formation.findIndex((slot) => slot.marineInstanceId === id)));
  return Object.values(state.swarms)
    .filter((swarm) => bluePositions.has(swarm.positionIndex))
    .flatMap((swarm) => [...swarm.cardIds, ...swarm.broodLordIds])
    .sort();
}

export function intimidationPickDecision(state: GameState, actionId: string): PendingDecision | null {
  const runtime = state.actionRuntime!;
  const targetCount = runtime.data.intimidationCount as number;
  if (runtime.selectedCardIds.length >= targetCount) return null;
  const eligible = intimidationEligibleCards(state).filter((id) => !runtime.selectedCardIds.includes(id));
  if (!eligible.length) return null;
  return makeDecision(state, "INTIMIDATION_PICK", actionId, "move.intimidationPick", eligible.map((cardId) => ({
    id: `card:${cardId}`,
    label: `${state.genestealers[cardId]?.icon ?? "BROOD LORD"} · ${cardId}`,
    payload: { cardId },
    canonicalEffectPreview: `Return ${cardId} to the smallest Blip`,
  })));
}

export function intimidationDestinationDecision(state: GameState, actionId: string): PendingDecision | null {
  const left = state.orderedSources["blip.left"].length;
  const right = state.orderedSources["blip.right"].length;
  if (left !== right) return null;
  return makeDecision(state, "INTIMIDATION_DESTINATION", actionId, "move.intimidationDestination", [
    { id: "left", label: "Return cards to the LEFT Blip", payload: { side: "LEFT" }, canonicalEffectPreview: null },
    { id: "right", label: "Return cards to the RIGHT Blip", payload: { side: "RIGHT" }, canonicalEffectPreview: null },
  ]);
}

export function removeCardsFromSwarms(state: GameState, cardIds: readonly string[]): void {
  const selected = new Set(cardIds);
  for (const swarm of Object.values(state.swarms)) {
    swarm.cardIds = swarm.cardIds.filter((id) => !selected.has(id));
    swarm.broodLordIds = swarm.broodLordIds.filter((id) => !selected.has(id));
    if (swarm.cardIds.length + swarm.broodLordIds.length === 0) {
      const slot = state.formation[swarm.positionIndex];
      slot.swarmIds[swarm.side] = slot.swarmIds[swarm.side].filter((id) => id !== swarm.id);
      delete state.swarms[swarm.id];
    }
  }
}

export function smallestBlipSide(state: GameState): Side | null {
  const left = state.orderedSources["blip.left"].length;
  const right = state.orderedSources["blip.right"].length;
  return left === right ? null : left < right ? "LEFT" : "RIGHT";
}
