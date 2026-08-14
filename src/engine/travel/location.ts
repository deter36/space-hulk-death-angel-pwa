import type { Side } from "@/src/data/types";
import { LOCATION_TERRAIN, LOCATIONS, MARINES, TERRAIN, locationDefinition, terrainDefinition } from "../actions/catalog";
import { makeDecision } from "../actions/support";
import { mechanicallyDistinctSlainCards } from "../combat/attack";
import type { GameState, PendingDecision, TerrainState } from "../state/game-state";

function marineName(state: GameState, marineId: string): string {
  return MARINES.find((marine) => marine.id === state.components[marineId].definitionId)!.name;
}

function swarmLabel(state: GameState, swarmId: string): string {
  const swarm = state.swarms[swarmId];
  return `F${swarm.positionIndex + 1} ${swarm.side} · ${swarm.cardIds.length + swarm.broodLordIds.length} Genestealers`;
}

export function doorTravelDecision(state: GameState): PendingDecision | null {
  const runtime = state.travelRuntime!;
  if (runtime.doorRemaining < 1) return null;
  const options: PendingDecision["legalOptions"] = [];
  for (const swarm of Object.values(state.swarms).sort((a, b) => a.positionIndex - b.positionIndex || a.side.localeCompare(b.side) || a.id.localeCompare(b.id))) {
    for (const cardId of mechanicallyDistinctSlainCards(state, swarm.id)) {
      options.push({
        id: `slay:${cardId}`,
        label: `${swarmLabel(state, swarm.id)} · ${state.genestealers[cardId]?.icon ?? "BROOD LORD"}`,
        payload: { stop: false, swarmId: swarm.id, cardId },
        canonicalEffectPreview: `Slay ${cardId}`,
      });
    }
  }
  if (!options.length) return null;
  options.push({ id: "stop", label: "Finish Door ability", payload: { stop: true }, canonicalEffectPreview: null });
  return makeDecision(state, "DOOR_TRAVEL_SLAY", "terrain.door", "travel.doorSlay", options);
}

export function totalDoorSupport(state: GameState): number {
  return Object.values(state.terrain)
    .filter((terrain) => terrainDefinition(terrain.instanceId).handlerId === "terrain.door")
    .reduce((sum, terrain) => sum + terrain.support, 0);
}

export function discardOldTerrain(state: GameState): void {
  for (const terrain of Object.values(state.terrain)) {
    state.supportSupply += terrain.support;
    state.components[terrain.instanceId].zone = "DISCARD";
    state.components[terrain.instanceId].containerId = null;
  }
  for (const slot of state.formation) slot.terrainInstanceIds = { LEFT: [], RIGHT: [] };
  state.terrain = {};
}

export function placeLocationTerrain(state: GameState, locationId: string): void {
  const placements = LOCATION_TERRAIN.filter((item) => item.locationId === locationId)
    .sort((a, b) => a.side.localeCompare(b.side) || a.markerOrder - b.markerOrder);
  for (const placement of placements) {
    const positionIndex = placement.countFrom === "TOP"
      ? Math.min(placement.distance - 1, state.formation.length - 1)
      : Math.max(state.formation.length - placement.distance, 0);
    const instanceId = placement.terrainId;
    state.components[instanceId].zone = "FORMATION";
    state.components[instanceId].containerId = `formation.${positionIndex}.${placement.side.toLowerCase()}`;
    const terrain: TerrainState = { instanceId, positionIndex, side: placement.side, support: 0, activatedThisRound: false, state: {} };
    state.terrain[instanceId] = terrain;
    state.formation[positionIndex].terrainInstanceIds[placement.side].push(instanceId);
  }
}

export function discardBlips(state: GameState): void {
  for (const sourceId of ["blip.left", "blip.right"] as const) {
    for (const cardId of state.orderedSources[sourceId]) {
      state.orderedSources["genestealer.discard"].push(cardId);
      state.components[cardId].zone = "DISCARD";
      state.components[cardId].containerId = "genestealer.discard";
    }
    state.orderedSources[sourceId] = [];
  }
}

export function computeBlipTargets(state: GameState, locationId: string): { left: number; right: number } {
  const location = locationDefinition(locationId);
  let available = state.orderedSources["genestealer.deck"].length + state.orderedSources["genestealer.discard"].length;
  let left = 0;
  let right = 0;
  while (available > 0 && (left < location.leftBlips || right < location.rightBlips)) {
    if (left < location.leftBlips && (right >= location.rightBlips || left <= right)) left += 1;
    else right += 1;
    available -= 1;
  }
  return { left, right };
}

export function nextRefillSide(state: GameState): Side | null {
  const runtime = state.travelRuntime!;
  const leftTarget = Number(runtime.data.leftTarget ?? 0);
  const rightTarget = Number(runtime.data.rightTarget ?? 0);
  const left = state.orderedSources["blip.left"].length;
  const right = state.orderedSources["blip.right"].length;
  if (left >= leftTarget && right >= rightTarget) return null;
  if (left < leftTarget && (right >= rightTarget || left <= right)) return "LEFT";
  return "RIGHT";
}

export function addGenestealerToSwarm(state: GameState, cardId: string, positionIndex: number, side: Side): string {
  const existingId = state.formation[positionIndex].swarmIds[side].find((id) => state.swarms[id]);
  const swarmId = existingId ?? `swarm.spawn.${cardId}`;
  if (!existingId) {
    state.swarms[swarmId] = { id: swarmId, positionIndex, side, cardIds: [], broodLordIds: [], attackedThisAttackPhase: false, effects: [] };
    state.formation[positionIndex].swarmIds[side].push(swarmId);
  }
  state.swarms[swarmId].cardIds.push(cardId);
  state.components[cardId].zone = "SWARM";
  state.components[cardId].containerId = swarmId;
  return swarmId;
}

export function arrivalMarineDecision(state: GameState, type: string, promptKey: string, filter?: (marineId: string) => boolean): PendingDecision | null {
  const marines = state.formation.map((slot) => slot.marineInstanceId).filter((id) => !filter || filter(id));
  if (!marines.length) return null;
  return makeDecision(state, type, state.currentLocationInstanceId, promptKey, marines.map((marineId) => ({
    id: `marine:${marineId}`,
    label: `F${state.formation.findIndex((slot) => slot.marineInstanceId === marineId) + 1} · ${marineName(state, marineId)}`,
    payload: { marineId },
    canonicalEffectPreview: null,
  })));
}

export function artefactPlacementDecision(state: GameState): PendingDecision {
  const options: PendingDecision["legalOptions"] = [];
  state.formation.forEach((_slot, positionIndex) => {
    for (const side of ["LEFT", "RIGHT"] as const) options.push({
      id: `place:${positionIndex}:${side}`,
      label: `F${positionIndex + 1} ${side}`,
      payload: { positionIndex, side },
      canonicalEffectPreview: `Place Artefact at F${positionIndex + 1} ${side}`,
    });
  });
  return makeDecision(state, "PLACE_ARTEFACT", state.currentLocationInstanceId, "location.placeArtefact", options);
}

export function swarmChoiceDecision(state: GameState, type: string, promptKey: string): PendingDecision | null {
  const swarms = Object.values(state.swarms).sort((a, b) => a.positionIndex - b.positionIndex || a.side.localeCompare(b.side) || a.id.localeCompare(b.id));
  if (!swarms.length) return null;
  return makeDecision(state, type, state.currentLocationInstanceId, promptKey, swarms.map((swarm) => ({
    id: `swarm:${swarm.id}`,
    label: swarmLabel(state, swarm.id),
    payload: { swarmId: swarm.id },
    canonicalEffectPreview: null,
  })));
}

export function controlPanelBlipDecision(state: GameState, type: string, promptKey: string): PendingDecision | null {
  const options = (["LEFT", "RIGHT"] as const).filter((side) => state.orderedSources[side === "LEFT" ? "blip.left" : "blip.right"].length > 0).map((side) => ({
    id: `side:${side}`,
    label: `${side} blip · ${state.orderedSources[side === "LEFT" ? "blip.left" : "blip.right"].length} cards`,
    payload: { side },
    canonicalEffectPreview: `Discard the top card of the ${side} blip`,
  }));
  return options.length ? makeDecision(state, type, state.currentLocationInstanceId, promptKey, options) : null;
}

export function apothecarionFacingDecision(state: GameState, marineId: string): PendingDecision {
  const current = state.marines[marineId].facing;
  const opposite: Side = current === "LEFT" ? "RIGHT" : "LEFT";
  return makeDecision(state, "APOTHECARION_FACING", state.currentLocationInstanceId, "location.apothecarionFacing", [
    { id: "keep", label: `Keep facing ${current}`, payload: { marineId, facing: current }, canonicalEffectPreview: null },
    { id: "flip", label: `Face ${opposite}`, payload: { marineId, facing: opposite }, canonicalEffectPreview: `Face ${opposite}` },
  ]);
}

export function teleportariumDecision(state: GameState, marineId: string): PendingDecision {
  const options: PendingDecision["legalOptions"] = [{ id: "roll", label: `${marineName(state, marineId)} · Roll the die`, payload: { marineId, spend: false }, canonicalEffectPreview: "Slain on a 0" }];
  if (state.marines[marineId].support > 0) options.unshift({ id: "spend", label: `${marineName(state, marineId)} · Discard 1 Support`, payload: { marineId, spend: true }, canonicalEffectPreview: "Avoid the roll" });
  return makeDecision(state, "TELEPORTARIUM_MARINE", state.currentLocationInstanceId, "location.teleportarium", options);
}

export function terrainChoiceDecision(state: GameState): PendingDecision | null {
  const terrains = Object.values(state.terrain).sort((a, b) => a.positionIndex - b.positionIndex || a.side.localeCompare(b.side) || a.instanceId.localeCompare(b.instanceId));
  if (!terrains.length) return null;
  return makeDecision(state, "CORE_COGITATOR_TERRAIN", state.currentLocationInstanceId, "location.coreCogitator", terrains.map((terrain) => ({
    id: `terrain:${terrain.instanceId}`,
    label: `F${terrain.positionIndex + 1} ${terrain.side} · ${terrainDefinition(terrain.instanceId).name}`,
    payload: { terrainId: terrain.instanceId },
    canonicalEffectPreview: "Limit this Terrain to 1 spawn next Event phase",
  })));
}

export function launchControlDecision(state: GameState): PendingDecision {
  const support = state.locationSupport[state.currentLocationInstanceId] ?? 0;
  const options: PendingDecision["legalOptions"] = [{ id: "roll", label: `Roll against ${support} Support`, payload: { place: false }, canonicalEffectPreview: `Win on ${support} or less` }];
  if (state.supportSupply > 0) options.unshift({ id: "place", label: "Place 1 Support on Launch Control", payload: { place: true }, canonicalEffectPreview: "Increase future launch chance" });
  return makeDecision(state, "LAUNCH_CONTROL", state.currentLocationInstanceId, "location.launchControl", options);
}

export function allGenestealerSlayDecision(state: GameState, type: string, promptKey: string, allowStop = true): PendingDecision | null {
  const options: PendingDecision["legalOptions"] = [];
  for (const swarm of Object.values(state.swarms)) {
    for (const cardId of mechanicallyDistinctSlainCards(state, swarm.id)) options.push({
      id: `slay:${cardId}`,
      label: `${swarmLabel(state, swarm.id)} · ${state.genestealers[cardId]?.icon ?? "BROOD LORD"}`,
      payload: { stop: false, swarmId: swarm.id, cardId },
      canonicalEffectPreview: `Slay ${cardId}`,
    });
  }
  if (!options.length) return null;
  if (allowStop) options.push({ id: "stop", label: "Finish slaying Genestealers", payload: { stop: true }, canonicalEffectPreview: null });
  return makeDecision(state, type, state.currentLocationInstanceId, promptKey, options);
}

export function placeArtefact(state: GameState, positionIndex: number, side: Side): void {
  const instanceId = "terrain.artefact";
  state.components[instanceId].zone = "FORMATION";
  state.components[instanceId].containerId = `formation.${positionIndex}.${side.toLowerCase()}`;
  state.terrain[instanceId] = { instanceId, positionIndex, side, support: 0, activatedThisRound: false, state: {} };
  state.formation[positionIndex].terrainInstanceIds[side].push(instanceId);
}

export function replaceTerrainDefinition(state: GameState, terrainId: string, definitionId: string): void {
  const terrain = state.terrain[terrainId];
  const oldComponent = state.components[terrainId];
  oldComponent.zone = "DISCARD";
  oldComponent.containerId = null;
  state.formation[terrain.positionIndex].terrainInstanceIds[terrain.side] = state.formation[terrain.positionIndex].terrainInstanceIds[terrain.side].filter((id) => id !== terrainId);
  delete state.terrain[terrainId];
  const replacementId = definitionId;
  state.components[replacementId].zone = "FORMATION";
  state.components[replacementId].containerId = `formation.${terrain.positionIndex}.${terrain.side.toLowerCase()}`;
  state.terrain[replacementId] = { instanceId: replacementId, positionIndex: terrain.positionIndex, side: terrain.side, support: 0, activatedThisRound: true, state: {} };
  state.formation[terrain.positionIndex].terrainInstanceIds[terrain.side].push(replacementId);
}

export function moveSwarmsToRedTerrain(state: GameState): void {
  for (const side of ["LEFT", "RIGHT"] as const) {
    const red = Object.values(state.terrain).find((terrain) => terrain.side === side && TERRAIN.find((definition) => definition.id === state.components[terrain.instanceId].definitionId)?.spawnColor === "RED");
    if (!red) continue;
    const swarms = Object.values(state.swarms).filter((swarm) => swarm.side === side);
    if (!swarms.length) continue;
    const primary = swarms[0];
    for (const swarm of swarms) state.formation[swarm.positionIndex].swarmIds[side] = state.formation[swarm.positionIndex].swarmIds[side].filter((id) => id !== swarm.id);
    primary.positionIndex = red.positionIndex;
    for (const absorbed of swarms.slice(1)) {
      for (const cardId of [...absorbed.cardIds, ...absorbed.broodLordIds]) state.components[cardId].containerId = primary.id;
      primary.cardIds.push(...absorbed.cardIds);
      primary.broodLordIds.push(...absorbed.broodLordIds);
      primary.effects.push(...absorbed.effects);
      delete state.swarms[absorbed.id];
    }
    state.formation[red.positionIndex].swarmIds[side].push(primary.id);
  }
}

export function spawnBroodLordsAtRedTerrain(state: GameState): void {
  const reserve = ["brood-lord.a.01", "brood-lord.b.01"].filter((id) => state.components[id].zone === "RESERVE");
  for (const side of ["LEFT", "RIGHT"] as const) {
    const red = Object.values(state.terrain).find((terrain) => terrain.side === side && TERRAIN.find((definition) => definition.id === state.components[terrain.instanceId].definitionId)?.spawnColor === "RED");
    const broodId = reserve.shift();
    if (!red || !broodId) continue;
    const existingId = state.formation[red.positionIndex].swarmIds[side].find((id) => state.swarms[id]);
    const swarmId = existingId ?? `swarm.spawn.${broodId}`;
    if (!existingId) {
      state.swarms[swarmId] = { id: swarmId, positionIndex: red.positionIndex, side, cardIds: [], broodLordIds: [], attackedThisAttackPhase: false, effects: [] };
      state.formation[red.positionIndex].swarmIds[side].push(swarmId);
    }
    state.swarms[swarmId].broodLordIds.push(broodId);
    state.components[broodId].zone = "SWARM";
    state.components[broodId].containerId = swarmId;
  }
}

export function isFinalLocation(state: GameState): boolean {
  return locationDefinition(state.currentLocationInstanceId).tier === "4";
}

export function genericFinalVictory(state: GameState): boolean {
  return isFinalLocation(state)
    && state.orderedSources["blip.left"].length === 0
    && state.orderedSources["blip.right"].length === 0
    && Object.keys(state.swarms).length === 0;
}

export function locationByHandler(handlerId: string) {
  return LOCATIONS.find((location) => location.handlerId === handlerId)!;
}
