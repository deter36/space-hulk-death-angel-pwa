import { describe, expect, it } from "vitest";
import type { TeamColor } from "@/src/data/types";
import { advanceAutomatic, newGame, submitDecision } from "../controller";
import { engineSessionFromResult, getUndoStatus, submitSessionDecision } from "../session/engine-session";
import { Sha256CounterRng } from "../rng/sha256-counter";
import type { EngineResult } from "../transitions/types";
import { assertStateInvariants } from "../validation/invariants";
import { eligibleSlainCards, legalAttackSwarms } from "./attack";

const ACTIONS = {
  BLUE: "action.blue.lead-by-example",
  PURPLE: "action.purple.flamer-attack",
  GREY: "action.grey.psionic-attack",
  GREEN: "action.green.dead-aim",
  RED: "action.red.full-auto",
  YELLOW: "action.yellow.heroic-charge",
} as const;

const ATTACKERS = {
  BLUE: "marine.blue.sergeant-lorenzo",
  PURPLE: "marine.purple.brother-zael",
  GREY: "marine.grey.lexicanium-calistarius",
  GREEN: "marine.green.brother-noctis",
  RED: "marine.red.brother-leon",
  YELLOW: "marine.yellow.brother-claudio",
} as const;

function teamsFor(team: TeamColor): [TeamColor, TeamColor, TeamColor] {
  return [team, ...(["GREEN", "YELLOW", "BLUE", "RED", "PURPLE", "GREY"] as TeamColor[]).filter((color) => color !== team).slice(0, 2)] as [TeamColor, TeamColor, TeamColor];
}

function seedFor(team: TeamColor, value: number, label: string): string {
  for (let index = 0; index < 500; index += 1) {
    const seed = `${label}.${index}`;
    const result = newGame({ gameId: `preview.${label}`, seed, teamColors: teamsFor(team) });
    if (Sha256CounterRng.restore(result.state.rng).rollCombatDie().value === value) return seed;
  }
  throw new Error(`No deterministic seed found for die value ${value}`);
}

function prepareAttack(team: keyof typeof ACTIONS, seed: string, minimumCards = 1): { result: EngineResult; swarmId: string; attackerId: string } {
  const setup = newGame({ gameId: `attack.${team}.${seed}`, seed, teamColors: teamsFor(team) });
  const state = structuredClone(setup.state);
  const actionId = ACTIONS[team];
  const attackerId = ATTACKERS[team];
  const attackerIndex = state.formation.findIndex((slot) => slot.marineInstanceId === attackerId);
  const swarm = Object.values(state.swarms)[0];
  state.formation[swarm.positionIndex].swarmIds[swarm.side] = state.formation[swarm.positionIndex].swarmIds[swarm.side].filter((id) => id !== swarm.id);
  swarm.positionIndex = attackerIndex;
  swarm.side = "RIGHT";
  state.formation[attackerIndex].swarmIds.RIGHT.push(swarm.id);
  state.marines[attackerId].facing = "RIGHT";
  while (swarm.cardIds.length < minimumCards) {
    const cardId = state.orderedSources["genestealer.deck"].shift()!;
    state.components[cardId].zone = "SWARM";
    state.components[cardId].containerId = swarm.id;
    swarm.cardIds.push(cardId);
  }
  state.phase = "RESOLVE_ACTIONS";
  state.actionQueue = [actionId];
  state.currentActionIndex = 0;
  state.actionStep = null;
  state.actionRuntime = null;
  state.pendingDecision = null;
  state.pendingQueue = [];
  state.components[actionId].zone = "SELECTED";
  state.components[actionId].containerId = "action.queue";
  return { result: advanceAutomatic(state), swarmId: swarm.id, attackerId };
}

function choose(result: EngineResult, optionId: string): EngineResult {
  return submitDecision(result.state, result.state.pendingDecision!.id, optionId);
}

function choosePayload(result: EngineResult, key: string, value: string | boolean): EngineResult {
  const option = result.state.pendingDecision!.legalOptions.find((candidate) => candidate.payload[key] === value)!;
  return choose(result, option.id);
}

function beginStandardAttack(result: EngineResult, attackerId: string, swarmId: string): EngineResult {
  result = choosePayload(result, "marineId", attackerId);
  return choosePayload(result, "swarmId", swarmId);
}

function keepAndResolve(result: EngineResult): EngineResult {
  if (result.state.pendingDecision?.type === "ATTACK_REROLL") result = choose(result, "keep");
  while (result.state.pendingDecision?.type === "ATTACK_SLAY") {
    const slay = result.state.pendingDecision.legalOptions.find((option) => !option.payload.stop)!;
    result = choose(result, slay.id);
  }
  return result;
}

describe("Attack actions", () => {
  it("uses player-selected Marine/target order, repeated Support rerolls, and an RNG undo barrier", () => {
    const prepared = prepareAttack("RED", "attack-reroll", 3);
    let result = prepared.result;
    result.state.marines[prepared.attackerId].support = 2;
    result.state.supportSupply -= 2;
    result = choosePayload(result, "marineId", prepared.attackerId);
    const targetDecision = result.state.pendingDecision!;
    const target = targetDecision.legalOptions.find((option) => option.payload.swarmId === prepared.swarmId)!;
    let session = engineSessionFromResult(result, "PLAYER");
    session = submitSessionDecision(session, targetDecision.id, target.id);
    expect(session.state.pendingDecision?.type).toBe("ATTACK_REROLL");
    expect(getUndoStatus(session).unavailableReason).toBe("RANDOMNESS_BARRIER");
    const first = session.state.activeDie!.rawValue;
    session = submitSessionDecision(session, session.state.pendingDecision!.id, "reroll");
    expect(session.state.activeDie!.rerolls[0].rawValue).toBe(first);
    expect(session.state.marines[prepared.attackerId].support).toBe(1);
  });

  it("Lead By Example offers one Support placement after the first Blue kill", () => {
    const seed = seedFor("BLUE", 1, "lead-kill");
    const prepared = prepareAttack("BLUE", seed, 2);
    let result = keepAndResolve(beginStandardAttack(prepared.result, prepared.attackerId, prepared.swarmId));
    expect(result.state.pendingDecision?.type).toBe("LEAD_BY_EXAMPLE");
    const recipient = result.state.formation.at(-1)!.marineInstanceId;
    result = choosePayload(result, "marineId", recipient);
    expect(result.state.marines[recipient].support).toBe(1);
    expect(result.state.supportSupply).toBe(11);
  });

  it("Flamer Attack ignores skulls and slays the rolled numeric count", () => {
    const seed = seedFor("PURPLE", 3, "flamer-three");
    const prepared = prepareAttack("PURPLE", seed, 5);
    const before = prepared.result.state.swarms[prepared.swarmId].cardIds.length;
    let result = beginStandardAttack(prepared.result, prepared.attackerId, prepared.swarmId);
    expect(result.state.activeDie?.rawValue).toBe(3);
    let choices = 0;
    while (result.state.pendingDecision?.type === "ATTACK_SLAY") {
      expect(result.state.pendingDecision.legalOptions.some((option) => option.payload.stop)).toBe(false);
      result = choose(result, result.state.pendingDecision.legalOptions[0].id);
      choices += 1;
    }
    expect(choices).toBe(3);
    expect(result.state.swarms[prepared.swarmId].cardIds.length).toBe(before - 3);
  });

  it("Psionic Attack grants an immediate retargetable bonus attack on a skull", () => {
    const seed = seedFor("GREY", 2, "psionic-skull");
    const prepared = prepareAttack("GREY", seed, 3);
    const result = keepAndResolve(beginStandardAttack(prepared.result, prepared.attackerId, prepared.swarmId));
    expect(result.state.pendingDecision?.type).toBe("ATTACK_MARINE");
    expect(result.state.pendingDecision?.promptKey).toBe("attack.psionicBonus");
    expect(result.state.pendingDecision?.legalOptions.some((option) => option.payload.bonus === true)).toBe(true);
  });

  it("Dead Aim turns a raw 4 into up to three chosen slays", () => {
    const seed = seedFor("GREEN", 4, "dead-aim-four");
    const prepared = prepareAttack("GREEN", seed, 4);
    let result = beginStandardAttack(prepared.result, prepared.attackerId, prepared.swarmId);
    expect(result.state.activeDie).toMatchObject({ rawValue: 4, skull: false });
    expect(result.state.pendingDecision?.type).toBe("ATTACK_SLAY");
    expect(result.state.pendingDecision?.legalOptions.some((option) => option.payload.stop)).toBe(true);
    result = choose(result, "stop");
    expect(result.state.swarms[prepared.swarmId].cardIds.length).toBeGreaterThanOrEqual(4);
  });

  it("Full Auto lets Leon attack up to three times and choose a target each time", () => {
    const prepared = prepareAttack("RED", "full-auto-three", 5);
    let result = prepared.result;
    for (let attack = 0; attack < 3; attack += 1) {
      expect(result.state.pendingDecision?.legalOptions.some((option) => option.payload.marineId === prepared.attackerId)).toBe(true);
      result = keepAndResolve(beginStandardAttack(result, prepared.attackerId, prepared.swarmId));
    }
    expect(result.state.pendingDecision?.legalOptions.some((option) => option.payload.marineId === prepared.attackerId)).toBe(false);
  });

  it("Heroic Charge ignores facing, slays up to three, rolls without rerolls, and shifts formation on a 0", () => {
    const seed = seedFor("YELLOW", 0, "heroic-zero");
    const prepared = prepareAttack("YELLOW", seed, 4);
    const beforeFormation = prepared.result.state.formation.length;
    prepared.result.state.marines[prepared.attackerId].support = 1;
    prepared.result.state.supportSupply -= 1;
    prepared.result.state.marines[prepared.attackerId].facing = "LEFT";
    let result = choosePayload(prepared.result, "marineId", prepared.attackerId);
    result = choosePayload(result, "heroicCharge", true);
    for (let index = 0; index < 3; index += 1) {
      expect(result.state.pendingDecision?.type).toBe("ATTACK_SLAY");
      result = choose(result, result.state.pendingDecision!.legalOptions.find((option) => !option.payload.stop)!.id);
    }
    expect(result.state.pendingDecision?.type).not.toBe("ATTACK_REROLL");
    expect(result.state.components[prepared.attackerId].zone).toBe("SLAIN");
    expect(result.state.formation).toHaveLength(beforeFormation - 1);
    expect(result.state.supportSupply).toBe(12);
    assertStateInvariants(result.state);
  });

  it("excludes Power Field swarms and protects Brood Lords while normal Genestealers remain", () => {
    const prepared = prepareAttack("RED", "protected-targets", 2);
    const state = prepared.result.state;
    state.swarms[prepared.swarmId].effects.push({ id: "power", sourceId: "test", startTiming: "NOW", expiryTiming: "END_OF_ROUND", targetIds: [prepared.swarmId], mergePropagation: "WHOLE_MERGED_SWARM", data: { cannotBeSlain: true } });
    expect(legalAttackSwarms(state, prepared.attackerId)).not.toContain(prepared.swarmId);
    expect(eligibleSlainCards(state, prepared.swarmId)).toEqual([]);
    state.swarms[prepared.swarmId].effects = [];
    state.swarms[prepared.swarmId].broodLordIds.push("brood-lord.a.01");
    state.components["brood-lord.a.01"].zone = "SWARM";
    state.components["brood-lord.a.01"].containerId = prepared.swarmId;
    expect(eligibleSlainCards(state, prepared.swarmId)).not.toContain("brood-lord.a.01");
  });
});
