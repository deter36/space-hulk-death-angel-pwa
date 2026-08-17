import { describe, expect, it } from "vitest";
import { EVENTS, eventDefinition, SOLO_SETUP, terrainDefinition } from "../actions/catalog";
import { advanceAutomatic, newGame, submitDecision } from "../controller";
import { slayMarine } from "../combat/attack";
import type { GameState } from "../state/game-state";
import type { EngineResult, TransitionRecord } from "../transitions/types";
import { assertStateInvariants } from "../validation/invariants";

const TEAMS = ["GREEN", "YELLOW", "RED"] as const;

function eventState(definitionId: string, label = definitionId): GameState {
  const state = structuredClone(newGame({ gameId: `event.${label}`, seed: `event-${label}`, teamColors: TEAMS }).state);
  const cardId = Object.values(state.components).find((component) => component.kind === "EVENT" && component.definitionId === definitionId)!.instanceId;
  state.orderedSources["event.deck"] = state.orderedSources["event.deck"].filter((id) => id !== cardId);
  state.orderedSources["event.discard"] = state.orderedSources["event.discard"].filter((id) => id !== cardId);
  state.orderedSources["event.deck"].unshift(cardId);
  state.components[cardId].zone = "DECK";
  state.components[cardId].containerId = "event.deck";
  state.phase = "EVENT";
  state.pendingDecision = null;
  state.pendingQueue = [];
  state.actionQueue = [];
  state.currentActionIndex = 0;
  state.actionStep = null;
  state.actionRuntime = null;
  return state;
}

function submit(result: EngineResult, optionId: string): EngineResult {
  return submitDecision(result.state, result.state.pendingDecision!.id, optionId);
}

function resolveEvent(state: GameState): { result: EngineResult; transitions: TransitionRecord[] } {
  let result = advanceAutomatic(state);
  const transitions = [...result.transitions];
  let guard = 0;
  while (result.state.phase === "EVENT" && result.state.pendingDecision && guard++ < 100) {
    result = submit(result, result.state.pendingDecision.legalOptions[0].id);
    transitions.push(...result.transitions);
  }
  expect(guard).toBeLessThan(100);
  return { result, transitions };
}

describe("Event phase", () => {
  it.each(EVENTS.map((event) => [event.id]))("resolves the complete %s card handler without stalling", (definitionId) => {
    const state = eventState(definitionId, `handler.${definitionId}`);
    for (const marine of Object.values(state.marines)) { marine.support += 1; state.supportSupply -= 1; }
    for (const team of state.activeTeams) state.teams[team].previousActionInstanceId = state.teams[team].actionInstanceIds[0];
    const { result, transitions } = resolveEvent(state);
    expect(result.state.phase).toBe("CHOOSE_ACTIONS");
    expect(result.state.round).toBe(2);
    for (let index = 1; index < transitions.length; index += 1) expect(transitions[index].preStateHash, `${definitionId} ${transitions[index - 1].type} → ${transitions[index].type}`).toBe(transitions[index - 1].postStateHash);
    assertStateInvariants(result.state);
  });

  it("resolves special text, both activation boxes, movement, discard, and round cleanup", () => {
    const state = eventState("event.chaos-of-battle", "lifecycle");
    const cardId = state.orderedSources["event.deck"][0];
    const definition = eventDefinition(cardId);
    const expectedSpawnDraws = definition.activations.reduce((total, activation) => {
      const terrainCount = Object.values(state.terrain).filter((terrain) => terrainDefinition(terrain.instanceId).spawnColor === activation.terrainColor).length;
      return total + terrainCount * (activation.severity === "MAJOR" ? SOLO_SETUP.majorSpawn : SOLO_SETUP.minorSpawn);
    }, 0);

    const { result, transitions } = resolveEvent(state);
    expect(result.state.round).toBe(2);
    expect(result.state.phase).toBe("CHOOSE_ACTIONS");
    expect(result.state.orderedSources["event.discard"]).toContain(cardId);
    expect(transitions.map((transition) => transition.type)).toContain("MARINES_FLIPPED");
    expect(transitions.map((transition) => transition.type)).toContain("EVENT_MOVEMENT_RESOLVED");
    expect(transitions.map((transition) => transition.type)).toContain("ROUND_ENDED");
    for (let index = 1; index < transitions.length; index += 1) expect(transitions[index].preStateHash, `${index}: ${transitions[index - 1].type} → ${transitions[index].type}`).toBe(transitions[index - 1].postStateHash);
    const spawnDraws = transitions.flatMap((transition) => transition.randomInputs).filter((random) => random.kind === "DRAW" && (random.sourceId === "blip.left" || random.sourceId === "blip.right"));
    expect(spawnDraws).toHaveLength(expectedSpawnDraws);
    assertStateInvariants(result.state);
  });

  it("keeps the corrected same-name Out of Thin Air copies mechanically distinct", () => {
    function movedBy(definitionId: string): { moved: string[]; state: GameState } {
      const state = eventState(definitionId, definitionId);
      for (const marine of Object.values(state.marines)) { marine.support += 1; state.supportSupply -= 1; }
      state.roundEffects.push({ id: "test.overwatch", sourceId: "action.red.overwatch", startTiming: "ACTION_RESOLVED", expiryTiming: "END_OF_ROUND", targetIds: Object.keys(state.marines), mergePropagation: "NONE", data: { handlerId: "action.overwatch" } });
      let result = advanceAutomatic(state);
      let guard = 0;
      while (result.state.pendingDecision?.type !== "EVENT_ATTACK" && guard++ < 30) result = submit(result, result.state.pendingDecision!.legalOptions[0].id);
      expect(result.state.pendingDecision?.type).toBe("EVENT_ATTACK");
      return { moved: [...result.state.eventRuntime!.movedCardIds].sort(), state: result.state };
    }

    const head = movedBy("event.out-of-thin-air.copy-1");
    const claw = movedBy("event.out-of-thin-air.copy-2");
    expect(eventDefinition(head.state.eventRuntime!.eventCardId!).movementIcon).toBe("HEAD");
    expect(eventDefinition(claw.state.eventRuntime!.eventCardId!).movementIcon).toBe("CLAW");
    expect(head.moved).not.toEqual(claw.moved);
  });

  it("carries Gun Jam into the next round and removes that team's Attack choice", () => {
    const state = eventState("event.gun-jam", "gun-jam");
    for (const team of state.activeTeams) state.teams[team].previousActionInstanceId = state.teams[team].actionInstanceIds.find((id) => id.includes("support") || id.includes("block") || id.includes("overwatch") || id.includes("defensive-stance")) ?? state.teams[team].actionInstanceIds[0];
    let result = advanceAutomatic(state);
    expect(result.state.pendingDecision?.type).toBe("EVENT_TEAM");
    const team = result.state.pendingDecision!.legalOptions[0].payload.team as string;
    result = submit(result, result.state.pendingDecision!.legalOptions[0].id);
    while (["EVENT_SPAWN_PRIORITY", "EVENT_MOVEMENT_ACK"].includes(result.state.pendingDecision?.type ?? "")) result = submit(result, result.state.pendingDecision!.legalOptions[0].id);
    expect(result.state.round).toBe(2);
    while (result.state.pendingDecision?.type === "CHOOSE_ACTION" && result.state.pendingDecision.sourceId !== `team.${team.toLowerCase()}`) result = submit(result, result.state.pendingDecision.legalOptions[0].id);
    expect(result.state.pendingDecision?.sourceId).toBe(`team.${team.toLowerCase()}`);
    const jammedTeamOptions = result.state.pendingDecision!.legalOptions.filter((option) => option.payload.team === team);
    expect(jammedTeamOptions.every((option) => !String(option.payload.actionId).includes("attack") && option.payload.actionId !== "action.red.full-auto")).toBe(true);
  });

  it("rescues an eligible slain Marine at the bottom without shifting the surviving formation", () => {
    const state = eventState("event.rescue-space-marine", "rescue");
    const marineId = state.formation[2].marineInstanceId;
    slayMarine(state, marineId);
    const survivors = state.formation.map((slot) => slot.marineInstanceId);
    let result = advanceAutomatic(state);
    const rescueOption = result.state.pendingDecision?.legalOptions.find((option) => option.payload.marineId === marineId);
    expect(rescueOption?.label).not.toContain("F0");
    expect(rescueOption?.canonicalEffectPreview).toBe("Return at the bottom of the formation facing right");
    result = submit(result, rescueOption!.id);
    expect(result.state.formation.slice(0, survivors.length).map((slot) => slot.marineInstanceId)).toEqual(survivors);
    expect(result.state.formation.at(-1)?.marineInstanceId).toBe(marineId);
    expect(result.state.marines[marineId].facing).toBe("RIGHT");
  });

  it("routes Full Scan's face-down blip discard through DRAW_CARD and a randomness barrier", () => {
    const { transitions } = resolveEvent(eventState("event.full-scan", "full-scan-barrier"));
    const draw = transitions.find((transition) => transition.type === "CARD_DRAWN" && (transition.sourceId === "blip.left" || transition.sourceId === "blip.right"));
    expect(draw?.undoBarrier).toBe("RANDOMNESS");
  });

  it("offers Enter Formation immediately before each next-round Move + Activate Action", () => {
    let result = resolveEvent(eventState("event.enter-formation", "enter-formation-timing")).result;
    while (result.state.pendingDecision?.type === "CHOOSE_ACTION") {
      const move = result.state.pendingDecision.legalOptions.find((option) => String(option.payload.actionId).includes("onward-brothers")
        || String(option.payload.actionId).includes("stealth-tactics")
        || String(option.payload.actionId).includes("reorganize")
        || String(option.payload.actionId).includes("forward-scouting")
        || String(option.payload.actionId).includes("intimidation")
        || String(option.payload.actionId).includes("run-and-gun"));
      result = submit(result, move!.id);
    }
    expect(result.state.pendingDecision?.type).toBe("ENTER_FORMATION_SUPPORT");
    expect(result.state.actionStep).toBeNull();
    result = submit(result, "skip");
    expect(result.state.actionRuntime).not.toBeNull();
    expect(result.state.actionStep).toBe("MOVE");
  });
});
