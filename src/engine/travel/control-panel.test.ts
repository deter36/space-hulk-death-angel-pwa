import { describe, expect, it } from "vitest";
import { advanceAutomatic, newGame, submitDecision } from "../controller";
import { terrainDefinition } from "../actions/catalog";
import type { GameState } from "../state/game-state";
import type { EngineResult } from "../transitions/types";

const TEAMS = ["GREEN", "YELLOW", "RED"] as const;

function controlPanelState(locationId: string, label = locationId): GameState {
  const state = structuredClone(newGame({ gameId: `panel.${label}`, seed: `panel-${label}`, teamColors: TEAMS }).state);
  state.components[state.currentLocationInstanceId].zone = "PREVIOUS";
  state.orderedSources["location.deck"] = state.orderedSources["location.deck"].filter((id) => id !== locationId);
  state.components[locationId].zone = "CURRENT";
  state.components[locationId].containerId = null;
  state.currentLocationInstanceId = locationId;
  const actionId = "action.red.onward-brothers";
  const marineId = state.teams.RED.marineInstanceIds[0];
  const positionIndex = state.formation.findIndex((slot) => slot.marineInstanceId === marineId);
  const terrainId = `terrain.control-panel#test.${label}`;
  state.components[terrainId] = { instanceId: terrainId, definitionId: "terrain.control-panel", kind: "TERRAIN", zone: "FORMATION", containerId: `formation.${positionIndex}.left` };
  state.terrain[terrainId] = { instanceId: terrainId, positionIndex, side: "LEFT", support: 0, activatedThisRound: true, state: {} };
  state.formation[positionIndex].terrainInstanceIds.LEFT.push(terrainId);
  state.phase = "RESOLVE_ACTIONS";
  state.actionQueue = [actionId];
  state.currentActionIndex = 0;
  state.actionStep = "CONTROL_PANEL";
  state.actionRuntime = { actionId, movedMarineIds: [], facingResolvedMarineIds: [], activationResolvedMarineIds: [marineId], specialResolvedMarineIds: [], selectedCardIds: [], data: { controlPanelTerrainId: terrainId, controlPanelMarineId: marineId } };
  state.pendingDecision = null;
  state.pendingQueue = [];
  return state;
}

function submit(result: EngineResult, optionId?: string): EngineResult {
  const decision = result.state.pendingDecision!;
  return submitDecision(result.state, decision.id, optionId ?? decision.legalOptions[0].id);
}

describe("Control Panel Location abilities", () => {
  it("Maintenance Tunnels replaces the activated panel with a Corridor", () => {
    const state = controlPanelState("location.maintenance-tunnels");
    const existingCorridor = state.terrain["terrain.corridor"];
    if (existingCorridor) {
      state.formation[existingCorridor.positionIndex].terrainInstanceIds[existingCorridor.side] = state.formation[existingCorridor.positionIndex].terrainInstanceIds[existingCorridor.side].filter((id) => id !== existingCorridor.instanceId);
      delete state.terrain[existingCorridor.instanceId];
      state.components[existingCorridor.instanceId].zone = "SUPPLY";
      state.components[existingCorridor.instanceId].containerId = null;
    }
    const result = advanceAutomatic(state);
    expect(result.transitions.map((transition) => transition.type)).toContain("TERRAIN_REPLACED");
    expect(Object.values(result.state.terrain).some((terrain) => terrainDefinition(terrain.instanceId).id === "terrain.corridor" && terrain.activatedThisRound)).toBe(true);
  });

  it("Cryo Control chooses a nonempty blip and discards through the canonical draw path", () => {
    let result = advanceAutomatic(controlPanelState("location.cryo-control"));
    expect(result.state.pendingDecision?.type).toBe("CRYO_CONTROL_BLIP");
    const before = result.state.orderedSources["genestealer.discard"].length;
    result = submit(result);
    expect(result.state.orderedSources["genestealer.discard"]).toHaveLength(before + 1);
    expect(result.transitions.map((transition) => transition.type)).toContain("CARD_DRAWN");
  });

  it("Apothecarion places Support and optionally changes that Marine's facing", () => {
    let result = advanceAutomatic(controlPanelState("location.apothecarion"));
    expect(result.state.pendingDecision?.type).toBe("APOTHECARION_MARINE");
    const marineId = result.state.pendingDecision!.legalOptions[0].payload.marineId as string;
    const originalFacing = result.state.marines[marineId].facing;
    result = submit(result);
    expect(result.state.pendingDecision?.type).toBe("APOTHECARION_FACING");
    result = submit(result, "flip");
    expect(result.state.marines[marineId].support).toBe(1);
    expect(result.state.marines[marineId].facing).not.toBe(originalFacing);
  });

  it("Teleportarium processes every Marine and always empties both blips", () => {
    const state = controlPanelState("location.teleportarium");
    for (const marine of Object.values(state.marines)) marine.support = 1;
    state.supportSupply -= Object.keys(state.marines).length;
    let result = advanceAutomatic(state);
    let spent = 0;
    while (result.state.pendingDecision?.type === "TELEPORTARIUM_MARINE") {
      result = submit(result, "spend");
      spent += 1;
    }
    expect(spent).toBe(6);
    expect(result.state.orderedSources["blip.left"]).toHaveLength(0);
    expect(result.state.orderedSources["blip.right"]).toHaveLength(0);
    expect(result.state.supportSupply).toBe(12);
  });

  it("Core Cogitator registers an exact next-Event Terrain spawn cap", () => {
    let result = advanceAutomatic(controlPanelState("location.core-cogitator"));
    expect(result.state.pendingDecision?.type).toBe("CORE_COGITATOR_TERRAIN");
    const terrainId = result.state.pendingDecision!.legalOptions[0].payload.terrainId as string;
    result = submit(result);
    expect(result.state.roundEffects).toContainEqual(expect.objectContaining({ targetIds: [terrainId], data: expect.objectContaining({ maximumSpawn: 1 }) }));
  });

  it("Genetorium and Toxin Pumping Station create canonical non-rerollable dice", () => {
    const genetorium = advanceAutomatic(controlPanelState("location.genetorium"));
    expect(genetorium.transitions.map((transition) => transition.type)).toContain("DIE_ROLLED");
    expect(genetorium.transitions.find((transition) => transition.type === "DIE_ROLLED")?.randomInputs[0].kind).toBe("DIE");
    expect(genetorium.state.pendingDecision?.type).not.toBe("ATTACK_REROLL");

    const toxin = advanceAutomatic(controlPanelState("location.toxin-pumping-station"));
    expect(toxin.transitions.map((transition) => transition.type)).toContain("DIE_ROLLED");
    if (toxin.state.pendingDecision) expect(toxin.state.pendingDecision.type).toBe("TOXIN_BLIP");
  });

  it("Launch Control can bank Location Support without losing conservation", () => {
    let result = advanceAutomatic(controlPanelState("location.launch-control-room"));
    expect(result.state.pendingDecision?.type).toBe("LAUNCH_CONTROL");
    result = submit(result, "place");
    expect(result.state.locationSupport["location.launch-control-room"]).toBe(1);
    expect(result.state.supportSupply).toBe(11);
  });

  it("Launch Control ends the game when its canonical roll is at or below banked Support", () => {
    const state = controlPanelState("location.launch-control-room", "launch-win");
    state.locationSupport[state.currentLocationInstanceId] = 5;
    state.supportSupply = 7;
    state.actionStep = "LAUNCH_CONTROL_RESOLVE";
    state.activeDie = {
      id: "die.launch-win",
      sourceId: state.currentLocationInstanceId,
      purpose: "LAUNCH_CONTROL_ROLL",
      rawValue: 4,
      skull: false,
      modifiedValue: 4,
      rerolls: [],
    };
    const result = advanceAutomatic(state);
    expect(result.state).toMatchObject({ status: "VICTORY", phase: "GAME_OVER" });
    expect(result.transitions.at(-1)?.type).toBe("GAME_WON");
  });
});
