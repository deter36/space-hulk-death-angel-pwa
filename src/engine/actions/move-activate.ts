import type { Side } from "@/src/data/types";
import type { GameState, PendingDecision } from "../state/game-state";
import { actionDefinition, MARINES, terrainDefinition } from "./catalog";
import { makeDecision } from "./support";

function marineName(state: GameState, marineId: string): string {
  const definitionId = state.components[marineId].definitionId;
  return MARINES.find((marine) => marine.id === definitionId)?.name ?? marineId;
}

function formationIndex(state: GameState, marineId: string): number {
  return state.formation.findIndex((slot) => slot.marineInstanceId === marineId);
}

export function movementDecision(state: GameState, actionId: string): PendingDecision | null {
  const runtime = state.actionRuntime!;
  const action = actionDefinition(actionId);
  const remaining = state.teams[action.team].marineInstanceIds.filter((id) => state.marines[id] && !runtime.movedMarineIds.includes(id));
  if (!remaining.length) return null;
  const reorganize = action.handlerId === "action.reorganize";
  const options: PendingDecision["legalOptions"] = [{ id: "finish", label: "Finish movement", payload: { finish: true }, canonicalEffectPreview: null }];
  for (const marineId of remaining) {
    const from = formationIndex(state, marineId);
    const destinations = reorganize
      ? state.formation.map((_, index) => index).filter((index) => index !== from)
      : [from - 1, from + 1].filter((index) => index >= 0 && index < state.formation.length);
    for (const to of destinations) {
      options.push({
        id: `move:${marineId}:${to}`,
        label: `${marineName(state, marineId)} · F${from + 1} → F${to + 1}`,
        payload: { finish: false, marineId, to },
        canonicalEffectPreview: `Swap Marine occupants at F${from + 1} and F${to + 1}`,
      });
    }
  }
  return makeDecision(state, "MOVE_MARINE", actionId, "move.chooseMarine", options);
}

export function applyMarineSwap(state: GameState, marineId: string, to: number): void {
  const from = formationIndex(state, marineId);
  if (from < 0 || to < 0 || to >= state.formation.length || from === to) throw new Error("Illegal Marine swap");
  const displacedId = state.formation[to].marineInstanceId;
  state.formation[from].marineInstanceId = displacedId;
  state.formation[to].marineInstanceId = marineId;
  state.components[marineId].containerId = `formation.${to}`;
  state.components[displacedId].containerId = `formation.${from}`;
  state.actionRuntime!.movedMarineIds.push(marineId);
}

export function facingDecision(state: GameState, actionId: string): PendingDecision | null {
  const action = actionDefinition(actionId);
  const runtime = state.actionRuntime!;
  const marineId = state.teams[action.team].marineInstanceIds.find((id) => state.marines[id] && !runtime.facingResolvedMarineIds.includes(id));
  if (!marineId) return null;
  const current = state.marines[marineId].facing;
  const opposite: Side = current === "LEFT" ? "RIGHT" : "LEFT";
  return makeDecision(state, "SET_FACING", actionId, "move.chooseFacing", [
    { id: `keep:${marineId}`, label: `${marineName(state, marineId)} · Keep facing ${current}`, payload: { marineId, facing: current }, canonicalEffectPreview: null },
    { id: `flip:${marineId}`, label: `${marineName(state, marineId)} · Face ${opposite}`, payload: { marineId, facing: opposite }, canonicalEffectPreview: `Face ${opposite}` },
  ]);
}

export function activationDecision(state: GameState, actionId: string): PendingDecision | null {
  const action = actionDefinition(actionId);
  const runtime = state.actionRuntime!;
  const marineId = state.teams[action.team].marineInstanceIds.find((id) => state.marines[id] && !runtime.activationResolvedMarineIds.includes(id));
  if (!marineId) return null;
  const positionIndex = formationIndex(state, marineId);
  const facing = state.marines[marineId].facing;
  const terrainIds = state.formation[positionIndex].terrainInstanceIds[facing].filter((terrainId) => {
    const terrain = state.terrain[terrainId];
    return terrain && !terrain.activatedThisRound && terrainDefinition(terrainId).activatable;
  });
  return makeDecision(state, "ACTIVATE_TERRAIN", actionId, "move.activateTerrain", [
    { id: `skip:${marineId}`, label: `${marineName(state, marineId)} · Do not activate Terrain`, payload: { skip: true, marineId }, canonicalEffectPreview: null },
    ...terrainIds.map((terrainId) => {
      const terrain = terrainDefinition(terrainId);
      return { id: `activate:${marineId}:${terrainId}`, label: `${marineName(state, marineId)} · Activate ${terrain.name}`, payload: { skip: false, marineId, terrainId }, canonicalEffectPreview: terrain.sourceText };
    }),
  ]);
}

export function onwardBrothersDecision(state: GameState, actionId: string, terrainId: string): PendingDecision {
  return makeDecision(state, "ONWARD_BROTHERS", actionId, "move.onwardBrothers", [
    { id: "skip", label: "Do not add another Support token", payload: { place: false, terrainId }, canonicalEffectPreview: null },
    { id: "place", label: "Place 1 additional Support on the Door", payload: { place: true, terrainId }, canonicalEffectPreview: "Door gains 1 additional Support" },
  ]);
}
