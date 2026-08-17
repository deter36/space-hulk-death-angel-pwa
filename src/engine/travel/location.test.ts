import { describe, expect, it } from "vitest";
import { advanceAutomatic, newGame, submitDecision } from "../controller";
import { locationDefinition, terrainDefinition } from "../actions/catalog";
import type { GameState } from "../state/game-state";
import type { EngineResult } from "../transitions/types";
import { assertStateInvariants } from "../validation/invariants";

const TEAMS = ["GREEN", "YELLOW", "RED"] as const;

function baseState(label: string): GameState {
  return structuredClone(newGame({ gameId: `travel.${label}`, seed: `travel-${label}`, teamColors: TEAMS }).state);
}

function discardAllSwarms(state: GameState): void {
  for (const swarm of Object.values(state.swarms)) {
    state.formation[swarm.positionIndex].swarmIds[swarm.side] = state.formation[swarm.positionIndex].swarmIds[swarm.side].filter((id) => id !== swarm.id);
    for (const cardId of [...swarm.cardIds, ...swarm.broodLordIds]) {
      const discard = state.components[cardId].kind === "BROOD_LORD" ? "brood-lord.discard" : "genestealer.discard";
      state.orderedSources[discard].push(cardId);
      state.components[cardId].zone = "DISCARD";
      state.components[cardId].containerId = discard;
    }
    delete state.swarms[swarm.id];
  }
}

function emptyBlip(state: GameState, side: "LEFT" | "RIGHT" = "LEFT"): void {
  const source = side === "LEFT" ? "blip.left" : "blip.right";
  for (const cardId of state.orderedSources[source]) {
    state.orderedSources["genestealer.discard"].push(cardId);
    state.components[cardId].zone = "DISCARD";
    state.components[cardId].containerId = "genestealer.discard";
  }
  state.orderedSources[source] = [];
}

function setNextLocation(state: GameState, locationId: string): void {
  for (const oldId of state.orderedSources["location.deck"]) {
    state.components[oldId].zone = "UNUSED";
    state.components[oldId].containerId = null;
  }
  state.orderedSources["location.deck"] = [locationId];
  state.components[locationId].zone = "DECK";
  state.components[locationId].containerId = "location.deck";
}

function startTravel(locationId: string, label = locationId): EngineResult {
  const state = baseState(label);
  discardAllSwarms(state);
  emptyBlip(state);
  setNextLocation(state, locationId);
  state.phase = "GENESTEALER_ATTACK";
  state.pendingDecision = null;
  state.pendingQueue = [];
  return resolveTravelAcks(advanceAutomatic(state));
}

function submit(result: EngineResult, optionId?: string): EngineResult {
  const decision = result.state.pendingDecision!;
  return resolveTravelAcks(submitDecision(result.state, decision.id, optionId ?? decision.legalOptions[0].id));
}

function resolveTravelAcks(result: EngineResult): EngineResult {
  let current = result;
  while (["TRAVEL_ANIMATION_ACK", "LOCATION_ARRIVAL_ACK"].includes(current.state.pendingDecision?.type ?? "")) {
    const decision = current.state.pendingDecision!;
    current = submitDecision(current.state, decision.id, decision.legalOptions[0].id);
  }
  return current;
}

function resolveGenestealerAttackHandoffs(result: EngineResult): EngineResult {
  let current = result;
  let guard = 0;
  while (["GENESTEALER_ATTACK_ACK", "DEFENSE_REROLL"].includes(current.state.pendingDecision?.type ?? "") && guard++ < 20) {
    current = submit(current, current.state.pendingDecision!.type === "GENESTEALER_ATTACK_ACK" ? "begin" : "keep");
  }
  return current;
}

function choosePayload(result: EngineResult, key: string, value: string | boolean): EngineResult {
  const option = result.state.pendingDecision!.legalOptions.find((candidate) => candidate.payload[key] === value)!;
  return submit(result, option.id);
}

describe("travel and Locations", () => {
  it("resolves Door slays before replacing Terrain, then draws, refills, and returns Terrain Support", () => {
    const state = baseState("door-window");
    const swarm = Object.values(state.swarms)[0];
    while (swarm.cardIds.length < 3) {
      const cardId = state.orderedSources["genestealer.deck"].shift()!;
      swarm.cardIds.push(cardId);
      state.components[cardId].zone = "SWARM";
      state.components[cardId].containerId = swarm.id;
    }
    state.terrain["terrain.door"].support = 2;
    state.supportSupply -= 2;
    emptyBlip(state);
    setNextLocation(state, "location.maintenance-tunnels");
    state.phase = "GENESTEALER_ATTACK";
    state.pendingDecision = null;
    state.pendingQueue = [];
    let result = resolveGenestealerAttackHandoffs(advanceAutomatic(state));
    expect(result.state.pendingDecision?.type).toBe("DOOR_TRAVEL_SLAY");
    result = submit(result, result.state.pendingDecision!.legalOptions.find((option) => !option.payload.stop)!.id);
    result = submit(result, result.state.pendingDecision!.legalOptions.find((option) => !option.payload.stop)!.id);
    expect(result.state.currentLocationInstanceId).toBe("location.maintenance-tunnels");
    expect(result.state.phase).toBe("EVENT");
    expect(Object.keys(result.state.terrain)).toHaveLength(4);
    expect(result.state.supportSupply).toBe(12);
    expect(result.state.swarms[swarm.id]?.cardIds.length ?? 0).toBe(1);
    assertStateInvariants(result.state);
  });

  it("places four distinct physical Terrain cards from the corrected Location layout", () => {
    const result = startTravel("location.service-shaft");
    const terrainIds = Object.keys(result.state.terrain);
    expect(terrainIds).toHaveLength(4);
    expect(new Set(terrainIds).size).toBe(4);
    expect(terrainIds.every((id) => id === terrainDefinition(id).id)).toBe(true);
    expect(Object.values(result.state.marines).every((marine) => marine.facing === "RIGHT")).toBe(true);
  });

  it("clamps Terrain placements to the reduced formation and preserves engaged swarms", () => {
    const state = baseState("clamp");
    const preservedCards = Object.values(state.swarms).flatMap((swarm) => swarm.cardIds);
    while (state.formation.length > 2) {
      const marineId = state.formation.at(-1)!.marineInstanceId;
      state.supportSupply += state.marines[marineId].support;
      delete state.marines[marineId];
      state.components[marineId].zone = "SLAIN";
      state.components[marineId].containerId = null;
      const removed = state.formation.pop()!;
      for (const side of ["LEFT", "RIGHT"] as const) {
        for (const terrainId of removed.terrainInstanceIds[side]) {
          state.terrain[terrainId].positionIndex = 1;
          state.formation[1].terrainInstanceIds[side].push(terrainId);
          state.components[terrainId].containerId = `formation.1.${side.toLowerCase()}`;
        }
        for (const swarmId of removed.swarmIds[side]) {
          state.swarms[swarmId].positionIndex = 1;
          state.formation[1].swarmIds[side].push(swarmId);
        }
      }
    }
    emptyBlip(state);
    setNextLocation(state, "location.main-corridor");
    state.phase = "GENESTEALER_ATTACK";
    state.pendingDecision = null;
    state.pendingQueue = [];
    const result = advanceAutomatic(state);
    expect(Object.values(result.state.terrain).every((terrain) => terrain.positionIndex < 2)).toBe(true);
    for (const cardId of preservedCards) expect(result.state.components[cardId].zone).toBe("SWARM");
  });

  it("enforces Munitorium's two distinct Support recipients", () => {
    let result = startTravel("location.munitorium");
    expect(result.state.pendingDecision?.type).toBe("MUNITORIUM_SUPPORT");
    const firstId = result.state.pendingDecision!.legalOptions[0].payload.marineId as string;
    result = submit(result);
    expect(result.state.pendingDecision?.legalOptions.some((option) => option.payload.marineId === firstId)).toBe(false);
    const secondId = result.state.pendingDecision!.legalOptions[0].payload.marineId as string;
    result = submit(result);
    expect(result.state.marines[firstId].support).toBe(1);
    expect(result.state.marines[secondId].support).toBe(1);
    expect(result.state.phase).toBe("EVENT");
  });

  it("resolves target-choice arrival effects and the Genestealer Lair setup", () => {
    let dark = startTravel("location.dark-catacombs");
    expect(dark.state.pendingDecision?.type).toBe("DARK_CATACOMBS_MARINE");
    const marineId = dark.state.pendingDecision!.legalOptions[0].payload.marineId as string;
    dark = submit(dark);
    const position = dark.state.formation.findIndex((slot) => slot.marineInstanceId === marineId);
    const behind = dark.state.marines[marineId].facing === "LEFT" ? "RIGHT" : "LEFT";
    expect(dark.state.formation[position].swarmIds[behind].length).toBeGreaterThan(0);

    const lair = startTravel("location.genestealer-lair");
    expect(["SWARM", "DISCARD"]).toContain(lair.state.components["brood-lord.a.01"].zone);
    expect(["SWARM", "DISCARD"]).toContain(lair.state.components["brood-lord.b.01"].zone);
    expect(Object.values(lair.state.swarms).flatMap((swarm) => swarm.broodLordIds)).toHaveLength(2);
  });

  it("keeps transition hash continuity through a full automatic travel", () => {
    const result = startTravel("location.service-shaft", "hash-chain");
    for (let index = 1; index < result.transitions.length; index += 1) {
      expect(result.transitions[index].preStateHash).toBe(result.transitions[index - 1].postStateHash);
    }
    expect(locationDefinition(result.state.currentLocationInstanceId).name).toBe("Service Shaft");
  });

  it("resolves automatic spawning and facing arrival effects at their exact destinations", () => {
    const main = startTravel("location.main-corridor", "arrival-main");
    const corridor = Object.values(main.state.terrain).find((terrain) => main.state.components[terrain.instanceId].definitionId === "terrain.corridor")!;
    const corridorCount = main.state.formation[corridor.positionIndex].swarmIds[corridor.side]
      .map((id) => main.state.swarms[id]).reduce((sum, swarm) => sum + swarm.cardIds.length, 0);
    expect(corridorCount).toBe(2);

    const lower = startTravel("location.lower-accessway", "arrival-lower");
    const topMarine = lower.state.formation[0].marineInstanceId;
    const behind = lower.state.marines[topMarine].facing === "LEFT" ? "RIGHT" : "LEFT";
    const behindCount = lower.state.formation[0].swarmIds[behind].map((id) => lower.state.swarms[id]).reduce((sum, swarm) => sum + swarm.cardIds.length, 0);
    expect(behindCount).toBe(2);

    const hibernation = startTravel("location.hibernation-cluster", "arrival-hibernation");
    expect(hibernation.state.orderedSources["blip.left"]).toHaveLength(6);
    expect(hibernation.state.orderedSources["blip.right"]).toHaveLength(6);

    const wreckage = startTravel("location.wreckage-labyrinth", "arrival-wreckage");
    for (const slot of wreckage.state.formation) {
      const marine = wreckage.state.marines[slot.marineInstanceId];
      expect(slot.terrainInstanceIds[marine.facing]).toHaveLength(0);
    }
  });

  it("places the Chapel Artefact and spawns Black Holds cards on the chosen swarm", () => {
    let chapel = startTravel("location.wrath-of-baal-chapel", "arrival-chapel");
    expect(chapel.state.pendingDecision?.type).toBe("PLACE_ARTEFACT");
    const placement = chapel.state.pendingDecision!.legalOptions.find((option) => option.payload.positionIndex === 2 && option.payload.side === "RIGHT")!;
    chapel = submit(chapel, placement.id);
    expect(chapel.state.terrain["terrain.artefact"]).toMatchObject({ positionIndex: 2, side: "RIGHT" });

    const state = baseState("arrival-black-holds");
    const swarm = Object.values(state.swarms)[0];
    const before = swarm.cardIds.length;
    emptyBlip(state);
    setNextLocation(state, "location.black-holds");
    state.phase = "GENESTEALER_ATTACK";
    state.pendingDecision = null;
    state.pendingQueue = [];
    let black = resolveGenestealerAttackHandoffs(advanceAutomatic(state));
    expect(black.state.pendingDecision?.type).toBe("BLACK_HOLDS_SWARM");
    black = choosePayload(black, "swarmId", swarm.id);
    expect(black.state.swarms[swarm.id]?.cardIds.length).toBe(before + 2);
  });

  it("recognizes both generic final-Location victory and the Lair Brood Lord victory", () => {
    const generic = baseState("generic-victory");
    discardAllSwarms(generic);
    emptyBlip(generic, "LEFT");
    emptyBlip(generic, "RIGHT");
    generic.components[generic.currentLocationInstanceId].zone = "PREVIOUS";
    generic.orderedSources["location.deck"] = generic.orderedSources["location.deck"].filter((id) => id !== "location.toxin-pumping-station");
    generic.components["location.toxin-pumping-station"].zone = "CURRENT";
    generic.components["location.toxin-pumping-station"].containerId = null;
    generic.currentLocationInstanceId = "location.toxin-pumping-station";
    generic.pendingDecision = null;
    generic.pendingQueue = [];
    const genericResult = advanceAutomatic(generic);
    expect(genericResult.state).toMatchObject({ status: "VICTORY", phase: "GAME_OVER" });
    expect(genericResult.transitions.at(-1)?.type).toBe("GAME_WON");

    const lair = baseState("lair-victory");
    lair.components[lair.currentLocationInstanceId].zone = "PREVIOUS";
    lair.orderedSources["location.deck"] = lair.orderedSources["location.deck"].filter((id) => id !== "location.genestealer-lair");
    lair.components["location.genestealer-lair"].zone = "CURRENT";
    lair.components["location.genestealer-lair"].containerId = null;
    lair.currentLocationInstanceId = "location.genestealer-lair";
    lair.pendingDecision = null;
    lair.pendingQueue = [];
    for (const broodId of ["brood-lord.a.01", "brood-lord.b.01"]) {
      lair.components[broodId].zone = "DISCARD";
      lair.components[broodId].containerId = "brood-lord.discard";
      lair.orderedSources["brood-lord.discard"].push(broodId);
    }
    const lairResult = advanceAutomatic(lair);
    expect(lairResult.state.status).toBe("VICTORY");
    expect(Object.keys(lairResult.state.swarms).length).toBeGreaterThan(0);
  });
});
