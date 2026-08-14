import { MARINES } from "../actions/catalog";
import { makeDecision } from "../actions/support";
import type { GameState, PendingDecision, SwarmState } from "../state/game-state";
import { mechanicallyDistinctSlainCards } from "./attack";

function marineName(state: GameState, marineId: string): string {
  const definitionId = state.components[marineId].definitionId;
  return MARINES.find((marine) => marine.id === definitionId)!.name;
}

function swarmLabel(swarm: SwarmState): string {
  const size = swarm.cardIds.length + swarm.broodLordIds.length;
  return `F${swarm.positionIndex + 1} ${swarm.side} · ${size} Genestealer${size === 1 ? "" : "s"}`;
}

export function buildGenestealerAttackQueue(state: GameState): string[] {
  return Object.values(state.swarms)
    .sort((left, right) => left.positionIndex - right.positionIndex
      || (left.side === right.side ? left.id.localeCompare(right.id) : left.side === "LEFT" ? -1 : 1))
    .map((swarm) => swarm.id);
}

export function defendingMarineId(state: GameState, swarmId: string): string | null {
  const swarm = state.swarms[swarmId];
  return swarm ? state.formation[swarm.positionIndex]?.marineInstanceId ?? null : null;
}

export function swarmSize(state: GameState, swarmId: string): number {
  const swarm = state.swarms[swarmId];
  return swarm ? swarm.cardIds.length + swarm.broodLordIds.length : 0;
}

export function broodLordCount(state: GameState, swarmId: string): number {
  return state.swarms[swarmId]?.broodLordIds.length ?? 0;
}

export function swarmCannotAttack(state: GameState, swarmId: string): boolean {
  return state.swarms[swarmId]?.effects.some((effect) => effect.data.cannotAttack === true) ?? true;
}

export function hasRoundAbility(state: GameState, handlerId: string, marineId: string): boolean {
  return state.roundEffects.some((effect) => effect.data.handlerId === handlerId
    && Number(effect.data.activeRound ?? state.round) === state.round
    && effect.targetIds.includes(marineId));
}

export function defenseRerollDecision(state: GameState, swarmId: string, marineId: string): PendingDecision | null {
  const marine = state.marines[marineId];
  const swarm = state.swarms[swarmId];
  if (!marine || !swarm || marine.support < 1 || marine.facing !== swarm.side) return null;
  return makeDecision(state, "DEFENSE_REROLL", swarmId, "defense.reroll", [
    {
      id: "keep",
      label: "Keep this defense result",
      payload: { reroll: false, marineId, swarmId },
      canonicalEffectPreview: null,
    },
    {
      id: "reroll",
      label: `Spend 1 Support from ${marineName(state, marineId)} to reroll`,
      payload: { reroll: true, marineId, swarmId },
      canonicalEffectPreview: "Replace the current defense result",
    },
  ]);
}

export function counterAttackSlayDecision(state: GameState, swarmId: string): PendingDecision | null {
  const swarm = state.swarms[swarmId];
  if (!swarm) return null;
  const eligible = mechanicallyDistinctSlainCards(state, swarmId);
  if (!eligible.length) return null;
  return makeDecision(state, "COUNTER_ATTACK_SLAY", swarmId, "defense.counterAttackSlay", eligible.map((cardId) => ({
    id: `slay:${cardId}`,
    label: `${swarmLabel(swarm)} · ${state.genestealers[cardId]?.icon ?? "BROOD LORD"} · ${cardId}`,
    payload: { cardId, swarmId },
    canonicalEffectPreview: `Slay ${cardId}`,
  })));
}

export function travelRequired(state: GameState): boolean {
  return state.orderedSources["location.deck"].length > 0
    && (state.orderedSources["blip.left"].length === 0 || state.orderedSources["blip.right"].length === 0);
}
