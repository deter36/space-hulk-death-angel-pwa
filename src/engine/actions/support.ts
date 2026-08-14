import type { Side } from "@/src/data/types";
import type { EffectState, GameState, PendingDecision, SwarmState } from "../state/game-state";
import { commitTransition } from "../transitions/commit";
import type { TransitionRecord } from "../transitions/types";
import { actionDefinition, MARINES } from "./catalog";

export function supportPlacementDecision(state: GameState, actionId: string): PendingDecision {
  const options = state.formation.map((slot, index) => {
    const definition = MARINES.find((marine) => marine.id === state.components[slot.marineInstanceId].definitionId)!;
    return {
      id: `marine:${slot.marineInstanceId}`,
      label: `F${index + 1} · ${definition.name}`,
      payload: { marineId: slot.marineInstanceId },
      canonicalEffectPreview: `Place 1 Support on ${definition.name}`,
    };
  });
  return makeDecision(state, "PLACE_SUPPORT", actionId, "support.chooseMarine", options);
}

function swarmLabel(swarm: SwarmState): string {
  const count = swarm.cardIds.length + swarm.broodLordIds.length;
  return `F${swarm.positionIndex + 1} ${swarm.side} · ${count} Genestealer${count === 1 ? "" : "s"}`;
}

export function strategizeDecision(state: GameState, actionId: string): PendingDecision | null {
  const options: PendingDecision["legalOptions"] = [{
    id: "skip",
    label: "Do not move a swarm",
    payload: { skip: true },
    canonicalEffectPreview: null,
  }];
  const swarms = Object.values(state.swarms).sort((a, b) => a.positionIndex - b.positionIndex || a.side.localeCompare(b.side) || a.id.localeCompare(b.id));
  for (const swarm of swarms) {
    for (const delta of [-1, 0, 1]) {
      const positionIndex = swarm.positionIndex + delta;
      if (positionIndex < 0 || positionIndex >= state.formation.length) continue;
      for (const side of [swarm.side, opposite(swarm.side)]) {
        if (delta === 0 && side === swarm.side) continue;
        options.push({
          id: `move:${swarm.id}:${positionIndex}:${side}`,
          label: `${swarmLabel(swarm)} → F${positionIndex + 1} ${side}`,
          payload: { skip: false, swarmId: swarm.id, positionIndex, side },
          canonicalEffectPreview: `Move ${swarm.id} to F${positionIndex + 1} ${side}`,
        });
      }
    }
  }
  return swarms.length ? makeDecision(state, "STRATEGIZE", actionId, "support.strategize", options) : null;
}

export function powerFieldDecision(state: GameState, actionId: string): PendingDecision | null {
  const swarms = Object.values(state.swarms).sort((a, b) => a.positionIndex - b.positionIndex || a.side.localeCompare(b.side) || a.id.localeCompare(b.id));
  if (!swarms.length) return null;
  return makeDecision(state, "POWER_FIELD", actionId, "support.powerField", [
    { id: "skip", label: "Do not deploy the Power Field", payload: { skip: true }, canonicalEffectPreview: null },
    ...swarms.map((swarm) => ({
      id: `swarm:${swarm.id}`,
      label: swarmLabel(swarm),
      payload: { skip: false, swarmId: swarm.id },
      canonicalEffectPreview: `${swarm.id} cannot attack or be slain this round`,
    })),
  ]);
}

export function makeDecision(
  state: GameState,
  type: string,
  sourceId: string,
  promptKey: string,
  legalOptions: PendingDecision["legalOptions"],
): PendingDecision {
  return {
    id: `decision.${state.transitionSeq + 1}.${type.toLowerCase().replaceAll("_", "-")}`,
    type,
    sourceId,
    promptKey,
    legalOptions,
    context: { round: state.round, phase: state.phase },
    createdAtTransition: state.transitionSeq + 1,
  };
}

export function registerSupportAbility(state: GameState, actionId: string): TransitionRecord {
  const action = actionDefinition(actionId);
  const targetIds = action.target && !action.target.startsWith("Any ") && !action.target.startsWith("Both ")
    ? MARINES.filter((marine) => marine.name === action.target).map((marine) => marine.id).filter((id) => state.marines[id])
    : state.teams[action.team].marineInstanceIds.filter((id) => state.marines[id]);
  const effect: EffectState = {
    id: `effect.round-${state.round}.${action.handlerId}`,
    sourceId: actionId,
    startTiming: action.timing ?? "ACTION_RESOLVED",
    expiryTiming: "END_OF_ROUND",
    targetIds,
    mergePropagation: "NONE",
    data: { handlerId: action.handlerId },
  };
  return commitTransition(state, "ACTION_EFFECT_REGISTERED", actionId, () => {
    state.roundEffects.push(effect);
    state.actionStep = "COMPLETE";
  });
}

export function applyStrategizeMove(state: GameState, swarmId: string, positionIndex: number, side: Side): void {
  const swarm = state.swarms[swarmId];
  if (!swarm) throw new Error(`Strategize target no longer exists: ${swarmId}`);
  const oldSlot = state.formation[swarm.positionIndex];
  oldSlot.swarmIds[swarm.side] = oldSlot.swarmIds[swarm.side].filter((id) => id !== swarmId);
  swarm.positionIndex = positionIndex;
  swarm.side = side;
  state.formation[positionIndex].swarmIds[side].push(swarmId);
}

export function applyPowerField(state: GameState, actionId: string, swarmId: string): void {
  const swarm = state.swarms[swarmId];
  if (!swarm) throw new Error(`Power Field target no longer exists: ${swarmId}`);
  swarm.effects.push({
    id: `effect.round-${state.round}.power-field.${swarmId}`,
    sourceId: actionId,
    startTiming: "AFTER_SUPPORT_ACTION",
    expiryTiming: "END_OF_ROUND",
    targetIds: [swarmId],
    mergePropagation: "WHOLE_MERGED_SWARM",
    data: { cannotAttack: true, cannotBeSlain: true },
  });
}

export function mergeStrategizeDestination(state: GameState, movedSwarmId: string): string[] {
  const primary = state.swarms[movedSwarmId];
  if (!primary) return [];
  const slot = state.formation[primary.positionIndex];
  const mergingIds = slot.swarmIds[primary.side].filter((id) => id !== movedSwarmId);
  for (const absorbedId of mergingIds) {
    const absorbed = state.swarms[absorbedId];
    for (const cardId of [...absorbed.cardIds, ...absorbed.broodLordIds]) state.components[cardId].containerId = movedSwarmId;
    primary.cardIds.push(...absorbed.cardIds);
    primary.broodLordIds.push(...absorbed.broodLordIds);
    primary.effects.push(...absorbed.effects.map((effect) => ({ ...effect, targetIds: effect.targetIds.map((id) => id === absorbedId ? movedSwarmId : id) })));
    state.roundEffects = state.roundEffects.map((effect) => ({ ...effect, targetIds: effect.targetIds.map((id) => id === absorbedId ? movedSwarmId : id) }));
    delete state.swarms[absorbedId];
  }
  slot.swarmIds[primary.side] = [movedSwarmId];
  return mergingIds;
}

function opposite(side: Side): Side {
  return side === "LEFT" ? "RIGHT" : "LEFT";
}
