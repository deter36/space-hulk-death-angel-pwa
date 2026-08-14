import { describe, expect, it } from "vitest";
import { actionDefinition } from "./catalog";
import { newGame, submitDecision } from "../controller";
import type { EngineResult } from "../transitions/types";
import { assertStateInvariants } from "../validation/invariants";
import { engineSessionFromResult, getUndoStatus, submitSessionDecision, undo } from "../session/engine-session";
import { Sha256CounterRng } from "../rng/sha256-counter";

function chooseAction(result: EngineResult, name: string): EngineResult {
  const decision = result.state.pendingDecision!;
  const option = decision.legalOptions.find((candidate) => actionDefinition(candidate.payload.actionId as string).name === name)!;
  return submitDecision(result.state, decision.id, option.id);
}

function submitOption(result: EngineResult, optionId?: string): EngineResult {
  const decision = result.state.pendingDecision!;
  return submitDecision(result.state, decision.id, optionId ?? decision.legalOptions[0].id);
}

function finishMoveBase(result: EngineResult): EngineResult {
  while (["MOVE_MARINE", "SET_FACING", "ACTIVATE_TERRAIN"].includes(result.state.pendingDecision?.type ?? "")) {
    const decision = result.state.pendingDecision!;
    const option = decision.type === "MOVE_MARINE"
      ? decision.legalOptions.find((candidate) => candidate.payload.finish)!
      : decision.type === "SET_FACING"
        ? decision.legalOptions.find((candidate) => candidate.id.startsWith("keep:"))!
        : decision.legalOptions.find((candidate) => candidate.payload.skip)!;
    result = submitDecision(result.state, decision.id, option.id);
  }
  return result;
}

function chooseThree(result: EngineResult, names: [string, string, string]): EngineResult {
  for (const name of names) result = chooseAction(result, name);
  return result;
}

describe("Move + Activate actions", () => {
  it("Reorganize swaps only Marine occupants across non-adjacent positions and undoes one decision", () => {
    let result = newGame({ gameId: "game.reorganize", seed: "DA-reorganize", teamColors: ["GREEN", "YELLOW", "RED"] });
    result = chooseThree(result, ["Block", "Reorganize", "Overwatch"]);
    result = submitOption(result);
    result = submitOption(result);
    expect(result.state.pendingDecision?.type).toBe("MOVE_MARINE");
    const decision = result.state.pendingDecision!;
    const move = decision.legalOptions.find((option) => {
      if (option.payload.finish) return false;
      const from = result.state.formation.findIndex((slot) => slot.marineInstanceId === option.payload.marineId);
      return Math.abs(from - (option.payload.to as number)) > 1;
    })!;
    const before = structuredClone(result.state);
    const from = before.formation.findIndex((slot) => slot.marineInstanceId === move.payload.marineId);
    const to = move.payload.to as number;
    const movingId = before.formation[from].marineInstanceId;
    const displacedId = before.formation[to].marineInstanceId;
    const positionalEntities = before.formation.map((slot) => ({ terrain: slot.terrainInstanceIds, swarms: slot.swarmIds }));
    let session = engineSessionFromResult(result, "PLAYER");
    session = submitSessionDecision(session, decision.id, move.id);
    expect(session.state.formation[to].marineInstanceId).toBe(movingId);
    expect(session.state.formation[from].marineInstanceId).toBe(displacedId);
    expect(session.state.formation.map((slot) => ({ terrain: slot.terrainInstanceIds, swarms: slot.swarmIds }))).toEqual(positionalEntities);
    session = undo(session);
    expect(session.state).toEqual(before);
  });

  it("Door activation places base and optional Onward Brothers Support", () => {
    let result = newGame({ gameId: "game.onward", seed: "DA-onward", teamColors: ["GREEN", "YELLOW", "RED"] });
    const state = structuredClone(result.state);
    const redMarineId = state.teams.RED.marineInstanceIds[0];
    const redIndex = state.formation.findIndex((slot) => slot.marineInstanceId === redMarineId);
    const displacedId = state.formation[0].marineInstanceId;
    state.formation[0].marineInstanceId = redMarineId;
    state.formation[redIndex].marineInstanceId = displacedId;
    state.components[redMarineId].containerId = "formation.0";
    state.components[displacedId].containerId = `formation.${redIndex}`;
    state.marines[redMarineId].facing = "LEFT";
    result = { ...result, state, pendingDecision: state.pendingDecision };
    result = chooseThree(result, ["Block", "Defensive Stance", "Onward Brothers!"]);
    result = submitOption(result);
    result = submitOption(result);
    result = submitDecision(result.state, result.state.pendingDecision!.id, "finish");
    while (result.state.pendingDecision?.type === "SET_FACING") result = submitOption(result);
    while (result.state.pendingDecision?.type === "ACTIVATE_TERRAIN" && !result.state.pendingDecision.legalOptions.some((option) => option.payload.terrainId === "terrain.door")) result = submitOption(result);
    const activation = result.state.pendingDecision!;
    const door = activation.legalOptions.find((option) => option.payload.terrainId === "terrain.door")!;
    result = submitDecision(result.state, activation.id, door.id);
    expect(result.state.pendingDecision?.type).toBe("ONWARD_BROTHERS");
    result = submitDecision(result.state, result.state.pendingDecision!.id, "place");
    result = finishMoveBase(result);
    expect(result.state.terrain["terrain.door"].support).toBe(2);
    expect(result.state.supportSupply).toBe(8);
    expect(result.state.phase).toBe("GENESTEALER_ATTACK");
    assertStateInvariants(result.state);
  });

  it("Artefact, Spore Chimney, and Promethium Tank resolve their complete handlers", () => {
    for (const terrainId of ["terrain.artefact", "terrain.spore-chimney", "terrain.promethium-tank"] as const) {
      let result = newGame({ gameId: `game.terrain.${terrainId}`, seed: `DA-${terrainId}`, teamColors: ["GREEN", "YELLOW", "RED"] });
      const state = structuredClone(result.state);
      const redMarineId = state.teams.RED.marineInstanceIds[0];
      const redIndex = state.formation.findIndex((slot) => slot.marineInstanceId === redMarineId);
      const displacedId = state.formation[0].marineInstanceId;
      state.formation[0].marineInstanceId = redMarineId;
      state.formation[redIndex].marineInstanceId = displacedId;
      state.components[redMarineId].containerId = "formation.0";
      state.components[displacedId].containerId = `formation.${redIndex}`;
      state.marines[redMarineId].facing = "LEFT";
      state.formation[0].terrainInstanceIds.LEFT = state.formation[0].terrainInstanceIds.LEFT.filter((id) => id !== "terrain.door");
      delete state.terrain["terrain.door"];
      state.components["terrain.door"].zone = "SUPPLY";
      state.components["terrain.door"].containerId = null;
      state.formation[0].terrainInstanceIds.LEFT.push(terrainId);
      state.terrain[terrainId] = { instanceId: terrainId, positionIndex: 0, side: "LEFT", support: 0, activatedThisRound: false, state: {} };
      state.components[terrainId].zone = "FORMATION";
      state.components[terrainId].containerId = "formation.0.left";
      result = { ...result, state, pendingDecision: state.pendingDecision };
      result = chooseThree(result, ["Block", "Defensive Stance", "Onward Brothers!"]);
      result = submitOption(result);
      result = submitOption(result);
      result = submitDecision(result.state, result.state.pendingDecision!.id, "finish");
      while (result.state.pendingDecision?.type === "SET_FACING") result = submitOption(result);
      while (result.state.pendingDecision?.type === "ACTIVATE_TERRAIN" && !result.state.pendingDecision.legalOptions.some((option) => option.payload.terrainId === terrainId)) result = submitOption(result);
      const activation = result.state.pendingDecision!;
      const activate = activation.legalOptions.find((option) => option.payload.terrainId === terrainId)!;
      result = submitDecision(result.state, activation.id, activate.id);
      if (terrainId === "terrain.artefact") {
        expect(result.state.components[terrainId].zone).toBe("PLAYER_POSSESSION");
        expect(result.state.terrain[terrainId]).toBeUndefined();
      } else if (terrainId === "terrain.spore-chimney") {
        expect(result.transitions.map((transition) => transition.type)).toContain("DIE_ROLLED");
        expect(["FORMATION", "DISCARD"]).toContain(result.state.components[terrainId].zone);
      } else {
        expect(result.transitions.map((transition) => transition.type)).toEqual(expect.arrayContaining(["PROMETHIUM_TANK_DETONATED", "DIE_ROLLED"]));
        expect(result.state.components[terrainId].zone).toBe("DISCARD");
        expect(result.state.terrain[terrainId]).toBeUndefined();
      }
      assertStateInvariants(result.state);
    }
  });

  it("Stealth Tactics discards through DRAW_CARD and closes player undo history", () => {
    let result = newGame({ gameId: "game.stealth", seed: "DA-stealth", teamColors: ["GREEN", "YELLOW", "GREY"] });
    result = chooseThree(result, ["Block", "Defensive Stance", "Stealth Tactics"]);
    result = submitOption(result);
    result = submitOption(result);
    result = finishMoveBase(result);
    expect(result.state.pendingDecision?.type).toBe("STEALTH_FIRST");
    const beforeLeft = result.state.orderedSources["blip.left"].length;
    let session = engineSessionFromResult(result, "PLAYER");
    const decision = session.state.pendingDecision!;
    session = submitSessionDecision(session, decision.id, "side:LEFT");
    expect(session.state.orderedSources["blip.left"]).toHaveLength(beforeLeft - 1);
    expect(session.state.orderedSources["genestealer.discard"]).toHaveLength(1);
    expect(getUndoStatus(session).unavailableReason).toBe("RANDOMNESS_BARRIER");
  });

  it("Forward Scouting reveals one exact Event and can place it on the bottom", () => {
    let result = newGame({ gameId: "game.scouting", seed: "DA-scouting", teamColors: ["GREEN", "YELLOW", "PURPLE"] });
    result = chooseThree(result, ["Block", "Defensive Stance", "Forward Scouting"]);
    result = submitOption(result);
    result = submitOption(result);
    result = finishMoveBase(result);
    const decision = result.state.pendingDecision!;
    expect(decision.type).toBe("FORWARD_SCOUTING_ORDER");
    const cardId = decision.legalOptions[0].payload.eventCardId as string;
    result = submitDecision(result.state, decision.id, "bottom");
    expect(result.state.orderedSources["event.deck"].at(-1)).toBe(cardId);
    expect(result.state.components[cardId]).toMatchObject({ zone: "DECK", containerId: "event.deck" });
  });

  it("Run and Gun spends Support, rolls through the shared RNG, and resolves the attack", () => {
    let result = newGame({ gameId: "game.run-gun", seed: "DA-run-gun", teamColors: ["GREEN", "YELLOW", "RED"] });
    const state = structuredClone(result.state);
    const swarm = Object.values(state.swarms)[0];
    const greenMarineId = state.teams.GREEN.marineInstanceIds[0];
    const greenIndex = state.formation.findIndex((slot) => slot.marineInstanceId === greenMarineId);
    const displacedId = state.formation[swarm.positionIndex].marineInstanceId;
    state.formation[swarm.positionIndex].marineInstanceId = greenMarineId;
    state.formation[greenIndex].marineInstanceId = displacedId;
    state.components[greenMarineId].containerId = `formation.${swarm.positionIndex}`;
    state.components[displacedId].containerId = `formation.${greenIndex}`;
    state.marines[greenMarineId].facing = swarm.side;
    result = { ...result, state, pendingDecision: state.pendingDecision };
    result = chooseThree(result, ["Run and Gun", "Defensive Stance", "Overwatch"]);
    for (let index = 0; index < 2; index += 1) {
      const placement = result.state.pendingDecision!;
      const target = placement.legalOptions.find((option) => option.payload.marineId === greenMarineId)!;
      result = submitDecision(result.state, placement.id, target.id);
    }
    result = finishMoveBase(result);
    expect(result.state.pendingDecision?.type).toBe("RUN_AND_GUN_ATTACK");
    const attack = result.state.pendingDecision!.legalOptions.find((option) => option.payload.attack)!;
    result = submitDecision(result.state, result.state.pendingDecision!.id, attack.id);
    expect(result.transitions.map((transition) => transition.type)).toContain("DIE_ROLLED");
    if (result.state.pendingDecision?.type === "ATTACK_REROLL") result = submitDecision(result.state, result.state.pendingDecision.id, "keep");
    if (result.state.pendingDecision?.type === "ATTACK_SLAY") result = submitOption(result);
    while (result.state.pendingDecision?.type === "RUN_AND_GUN_ATTACK") result = submitOption(result);
    expect(result.state.phase).toBe("GENESTEALER_ATTACK");
    expect(result.state.supportSupply).toBe(11);
    assertStateInvariants(result.state);
  });

  it("Intimidation selects individual engaged cards and shuffles them into the smallest Blip", () => {
    let result: EngineResult | null = null;
    let expectedCount = 0;
    for (let seedIndex = 0; seedIndex < 20 && !result; seedIndex += 1) {
      let candidate = newGame({ gameId: `game.intimidation.${seedIndex}`, seed: `DA-intimidation-${seedIndex}`, teamColors: ["GREEN", "YELLOW", "BLUE"] });
      const state = structuredClone(candidate.state);
      const swarm = Object.values(state.swarms)[0];
      const blueMarineId = state.teams.BLUE.marineInstanceIds[0];
      const blueIndex = state.formation.findIndex((slot) => slot.marineInstanceId === blueMarineId);
      const displacedId = state.formation[swarm.positionIndex].marineInstanceId;
      state.formation[swarm.positionIndex].marineInstanceId = blueMarineId;
      state.formation[blueIndex].marineInstanceId = displacedId;
      state.components[blueMarineId].containerId = `formation.${swarm.positionIndex}`;
      state.components[displacedId].containerId = `formation.${blueIndex}`;
      candidate = { ...candidate, state, pendingDecision: state.pendingDecision };
      candidate = chooseThree(candidate, ["Block", "Defensive Stance", "Intimidation"]);
      candidate = submitOption(candidate);
      candidate = submitOption(candidate);
      candidate = finishMoveBase(candidate);
      const preview = Sha256CounterRng.restore(candidate.state.rng).rollCombatDie();
      const eligible = Object.values(candidate.state.swarms).filter((item) => item.positionIndex === swarm.positionIndex).reduce((sum, item) => sum + item.cardIds.length + item.broodLordIds.length, 0);
      if (preview.value > 0 && eligible > 0) {
        result = candidate;
        expectedCount = Math.min(preview.value, eligible);
      }
    }
    expect(result).not.toBeNull();
    const blipsBefore = result!.state.orderedSources["blip.left"].length + result!.state.orderedSources["blip.right"].length;
    expect(result!.state.pendingDecision?.type).toBe("INTIMIDATION_ROLL");
    result = submitDecision(result!.state, result!.state.pendingDecision!.id, "roll");
    for (let index = 0; index < expectedCount; index += 1) {
      expect(result!.state.pendingDecision?.type).toBe("INTIMIDATION_PICK");
      result = submitOption(result!);
    }
    if (result!.state.pendingDecision?.type === "INTIMIDATION_DESTINATION") result = submitOption(result!);
    const blipsAfter = result!.state.orderedSources["blip.left"].length + result!.state.orderedSources["blip.right"].length;
    expect(blipsAfter - blipsBefore).toBe(expectedCount);
    expect(result!.transitions.map((transition) => transition.type)).toContain("GENESTEALERS_RETURNED_TO_BLIP");
    expect(result!.state.phase).toBe("GENESTEALER_ATTACK");
    assertStateInvariants(result!.state);
  });
});
