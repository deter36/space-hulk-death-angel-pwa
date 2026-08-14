import { describe, expect, it } from "vitest";
import { advanceAutomatic, newGame, submitDecision } from "../controller";
import { Sha256CounterRng } from "../rng/sha256-counter";
import { engineSessionFromResult, getUndoStatus, submitSessionDecision } from "../session/engine-session";
import type { EffectState, GameState, SwarmState } from "../state/game-state";
import type { EngineResult } from "../transitions/types";
import { assertStateInvariants } from "../validation/invariants";

const TEAMS = ["GREEN", "YELLOW", "BLUE"] as const;

function seedForRolls(label: string, predicate: (values: number[], skulls: boolean[]) => boolean): string {
  for (let index = 0; index < 1000; index += 1) {
    const seed = `${label}.${index}`;
    const result = newGame({ gameId: `preview.${label}`, seed, teamColors: TEAMS });
    const rng = Sha256CounterRng.restore(result.state.rng);
    const rolls = [rng.rollCombatDie(), rng.rollCombatDie(), rng.rollCombatDie()];
    if (predicate(rolls.map((roll) => roll.value), rolls.map((roll) => roll.skull))) return seed;
  }
  throw new Error(`No deterministic seed found for ${label}`);
}

function hostileState(seed: string): GameState {
  const state = structuredClone(newGame({ gameId: `hostile.${seed}`, seed, teamColors: TEAMS }).state);
  state.phase = "GENESTEALER_ATTACK";
  state.actionQueue = [];
  state.currentActionIndex = 0;
  state.actionStep = null;
  state.actionRuntime = null;
  state.pendingDecision = null;
  state.pendingQueue = [];
  state.activeDie = null;
  state.genestealerAttackQueue = [];
  state.currentGenestealerAttackIndex = 0;
  state.genestealerAttackStep = null;
  state.genestealerAttackRuntime = null;
  return state;
}

function keepOnlySwarms(state: GameState, count: number): SwarmState[] {
  const ordered = Object.values(state.swarms).sort((left, right) => left.id.localeCompare(right.id));
  const kept = ordered.slice(0, count);
  for (const swarm of ordered.slice(count)) {
    state.formation[swarm.positionIndex].swarmIds[swarm.side] = state.formation[swarm.positionIndex].swarmIds[swarm.side].filter((id) => id !== swarm.id);
    for (const cardId of [...swarm.cardIds, ...swarm.broodLordIds]) {
      const discard = state.components[cardId].kind === "BROOD_LORD" ? "brood-lord.discard" : "genestealer.discard";
      state.orderedSources[discard].push(cardId);
      state.components[cardId].zone = "DISCARD";
      state.components[cardId].containerId = discard;
    }
    delete state.swarms[swarm.id];
  }
  while (kept.length < count) {
    const id = `swarm.test.${kept.length + 1}`;
    const cardId = state.orderedSources["genestealer.deck"].shift()!;
    const swarm: SwarmState = { id, positionIndex: 0, side: "LEFT", cardIds: [cardId], broodLordIds: [], attackedThisAttackPhase: false, effects: [] };
    state.swarms[id] = swarm;
    state.formation[0].swarmIds.LEFT.push(id);
    state.components[cardId].zone = "SWARM";
    state.components[cardId].containerId = id;
    kept.push(swarm);
  }
  return kept;
}

function relocateSwarm(state: GameState, swarm: SwarmState, positionIndex: number, side: "LEFT" | "RIGHT"): void {
  state.formation[swarm.positionIndex].swarmIds[swarm.side] = state.formation[swarm.positionIndex].swarmIds[swarm.side].filter((id) => id !== swarm.id);
  swarm.positionIndex = positionIndex;
  swarm.side = side;
  state.formation[positionIndex].swarmIds[side].push(swarm.id);
}

function setDefender(state: GameState, swarm: SwarmState, marineId: string, facing: "LEFT" | "RIGHT" = swarm.side): void {
  const targetIndex = swarm.positionIndex;
  const currentIndex = state.formation.findIndex((slot) => slot.marineInstanceId === marineId);
  const displacedId = state.formation[targetIndex].marineInstanceId;
  state.formation[targetIndex].marineInstanceId = marineId;
  state.formation[currentIndex].marineInstanceId = displacedId;
  state.components[marineId].containerId = `formation.${targetIndex}`;
  state.components[displacedId].containerId = `formation.${currentIndex}`;
  state.marines[marineId].facing = facing;
}

function addCards(state: GameState, swarm: SwarmState, desiredSize: number): void {
  while (swarm.cardIds.length + swarm.broodLordIds.length < desiredSize) {
    const cardId = state.orderedSources["genestealer.deck"].shift()!;
    state.components[cardId].zone = "SWARM";
    state.components[cardId].containerId = swarm.id;
    swarm.cardIds.push(cardId);
  }
}

function ability(sourceId: string, handlerId: string, targetId: string): EffectState {
  return {
    id: `effect.${handlerId}.${targetId}`,
    sourceId,
    startTiming: "DEFENSE",
    expiryTiming: "END_OF_ROUND",
    targetIds: [targetId],
    mergePropagation: "NONE",
    data: { handlerId },
  };
}

function submit(result: EngineResult, optionId: string): EngineResult {
  return submitDecision(result.state, result.state.pendingDecision!.id, optionId);
}

describe("Genestealer attack phase", () => {
  it("builds a top-to-bottom, left-before-right queue and skips Power Field swarms", () => {
    const state = hostileState("queue-order");
    const swarms = keepOnlySwarms(state, 3);
    relocateSwarm(state, swarms[0], 3, "RIGHT");
    relocateSwarm(state, swarms[1], 1, "RIGHT");
    relocateSwarm(state, swarms[2], 1, "LEFT");
    for (const swarm of swarms) swarm.effects.push({ id: `power.${swarm.id}`, sourceId: "test", startTiming: "NOW", expiryTiming: "END_OF_ROUND", targetIds: [swarm.id], mergePropagation: "WHOLE_MERGED_SWARM", data: { cannotAttack: true, cannotBeSlain: true } });
    const result = advanceAutomatic(state);
    const prevented = result.transitions.filter((transition) => transition.type === "GENESTEALER_ATTACK_PREVENTED").map((transition) => transition.sourceId);
    expect(prevented).toEqual([swarms[2].id, swarms[1].id, swarms[0].id]);
    expect(result.state.phase).toBe("EVENT");
  });

  it("keeps raw die data while applying cumulative Brood Lord penalties", () => {
    const state = hostileState("brood-penalty");
    const [swarm] = keepOnlySwarms(state, 1);
    const marineId = state.formation[swarm.positionIndex].marineInstanceId;
    state.marines[marineId].facing = swarm.side;
    state.marines[marineId].support = 1;
    state.supportSupply -= 1;
    for (const broodId of ["brood-lord.a.01", "brood-lord.b.01"]) {
      state.components[broodId].zone = "SWARM";
      state.components[broodId].containerId = swarm.id;
      swarm.broodLordIds.push(broodId);
    }
    const result = advanceAutomatic(state);
    expect(result.state.pendingDecision?.type).toBe("DEFENSE_REROLL");
    expect(result.state.activeDie!.modifiedValue).toBe(result.state.activeDie!.rawValue - 2);
    expect(result.state.activeDie!.skull).toBe([1, 2, 3].includes(result.state.activeDie!.rawValue));
  });

  it("rolls the defense die even when swarm size makes an ordinary save impossible", () => {
    const state = hostileState("unavoidable-roll");
    const [swarm] = keepOnlySwarms(state, 1);
    addCards(state, swarm, 6);
    const defenderId = state.formation[swarm.positionIndex].marineInstanceId;
    const result = advanceAutomatic(state);
    expect(result.transitions.map((transition) => transition.type)).toContain("DIE_ROLLED");
    expect(result.state.marines[defenderId]).toBeUndefined();
  });

  it("allows facing defenders to spend repeated Support and makes each reroll an undo barrier", () => {
    const state = hostileState("defense-reroll");
    const [swarm] = keepOnlySwarms(state, 1);
    const marineId = state.formation[swarm.positionIndex].marineInstanceId;
    state.marines[marineId].facing = swarm.side;
    state.marines[marineId].support = 2;
    state.supportSupply -= 2;
    let result = advanceAutomatic(state);
    expect(result.state.pendingDecision?.type).toBe("DEFENSE_REROLL");
    const firstRoll = result.state.activeDie!.rawValue;
    let session = engineSessionFromResult(result, "PLAYER");
    session = submitSessionDecision(session, session.state.pendingDecision!.id, "reroll");
    expect(session.state.activeDie!.rerolls[0].rawValue).toBe(firstRoll);
    expect(session.state.marines[marineId].support).toBe(1);
    expect(getUndoStatus(session).unavailableReason).toBe("RANDOMNESS_BARRIER");

    const behind = hostileState("defense-behind");
    const [behindSwarm] = keepOnlySwarms(behind, 1);
    const behindMarine = behind.formation[behindSwarm.positionIndex].marineInstanceId;
    behind.marines[behindMarine].facing = behindSwarm.side === "LEFT" ? "RIGHT" : "LEFT";
    behind.marines[behindMarine].support = 1;
    behind.supportSupply -= 1;
    result = advanceAutomatic(behind);
    expect(result.state.pendingDecision).toBeNull();
  });

  it("Block turns Gideon's raw skull into a miss, including from behind", () => {
    const seed = seedForRolls("block-skull", (_values, skulls) => skulls[0]);
    const state = hostileState(seed);
    const [swarm] = keepOnlySwarms(state, 1);
    setDefender(state, swarm, "marine.green.sergeant-gideon", swarm.side === "LEFT" ? "RIGHT" : "LEFT");
    state.roundEffects.push(ability("action.green.block", "action.block", "marine.green.sergeant-gideon"));
    const result = advanceAutomatic(state);
    expect(result.transitions.map((transition) => transition.type)).toContain("GENESTEALER_ATTACK_MISSED");
    expect(result.state.marines["marine.green.sergeant-gideon"]).toBeDefined();
  });

  it("Defensive Stance makes a nonzero Support reroll miss", () => {
    const seed = seedForRolls("stance-reroll", (values) => values[1] > 0);
    const state = hostileState(seed);
    const [swarm] = keepOnlySwarms(state, 1);
    const marineId = "marine.yellow.brother-goriel";
    setDefender(state, swarm, marineId);
    state.marines[marineId].support = 1;
    state.supportSupply -= 1;
    state.roundEffects.push(ability("action.yellow.defensive-stance", "action.defensive-stance", marineId));
    let result = advanceAutomatic(state);
    expect(result.state.pendingDecision?.type).toBe("DEFENSE_REROLL");
    result = submit(result, "reroll");
    expect(result.transitions.map((transition) => transition.type)).toContain("GENESTEALER_ATTACK_MISSED");
    expect(result.state.marines[marineId]).toBeDefined();
  });

  it("Counter Attack works from behind, slays an eligible card, and immediately repeats while the swarm remains", () => {
    const seed = seedForRolls("counter-skull", (_values, skulls) => skulls[0]);
    const state = hostileState(seed);
    const [swarm] = keepOnlySwarms(state, 1);
    addCards(state, swarm, 3);
    const marineId = "marine.blue.sergeant-lorenzo";
    setDefender(state, swarm, marineId, swarm.side === "LEFT" ? "RIGHT" : "LEFT");
    state.roundEffects.push(ability("action.blue.counter-attack", "action.counter-attack", marineId));
    let result = advanceAutomatic(state);
    expect(result.state.pendingDecision?.type).toBe("COUNTER_ATTACK_SLAY");
    const before = state.swarms[swarm.id].cardIds.length;
    result = submit(result, result.state.pendingDecision!.legalOptions[0].id);
    expect(result.state.swarms[swarm.id]?.cardIds.length).toBeLessThan(before);
    expect(result.transitions.some((transition) => transition.type === "DIE_ROLLED")).toBe(true);
  });

  it("shifts the formation immediately and never requeues an already-attacked colliding swarm", () => {
    const seed = seedForRolls("death-shift", (values) => values[0] === 0);
    const state = hostileState(seed);
    const [first, second] = keepOnlySwarms(state, 2);
    relocateSwarm(state, first, 3, "LEFT");
    relocateSwarm(state, second, 4, "LEFT");
    addCards(state, first, 2);
    addCards(state, second, 1);
    const before = state.formation.length;
    const result = advanceAutomatic(state);
    const starts = result.transitions.filter((transition) => transition.type === "GENESTEALER_ATTACK_STARTED").map((transition) => transition.sourceId);
    expect(starts.filter((id) => id === first.id)).toHaveLength(1);
    expect(starts.filter((id) => id === second.id)).toHaveLength(1);
    expect(result.state.formation.length).toBeLessThan(before);
    assertStateInvariants(result.state);
  });

  it("enters Event normally and completes travel when a blip is empty", () => {
    const normal = hostileState("no-swarms");
    keepOnlySwarms(normal, 0);
    const normalResult = advanceAutomatic(normal);
    expect(normalResult.state.phase).toBe("EVENT");

    const travel = hostileState("travel-gate");
    keepOnlySwarms(travel, 0);
    for (const cardId of travel.orderedSources["blip.left"]) {
      travel.components[cardId].zone = "DISCARD";
      travel.components[cardId].containerId = "genestealer.discard";
      travel.orderedSources["genestealer.discard"].push(cardId);
    }
    travel.orderedSources["blip.left"] = [];
    travel.orderedSources["location.deck"] = [
      "location.service-shaft",
      ...travel.orderedSources["location.deck"].filter((id) => id !== "location.service-shaft"),
    ];
    travel.components["location.service-shaft"].zone = "DECK";
    travel.components["location.service-shaft"].containerId = "location.deck";
    const travelResult = advanceAutomatic(travel);
    expect(travelResult.state.phase).toBe("EVENT");
    expect(travelResult.state.currentLocationInstanceId).toBe("location.service-shaft");
    expect(travelResult.transitions.map((transition) => transition.type)).toEqual(expect.arrayContaining(["TRAVEL_STARTED", "TRAVEL_COMPLETED"]));
    expect(travelResult.state.pendingQueue.some((checkpoint) => checkpoint.timing === "TRAVEL_REQUIRED")).toBe(false);
  });
});
