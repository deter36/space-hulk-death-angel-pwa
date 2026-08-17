import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { actionDefinition, eventDefinition } from "../actions/catalog";
import { intimidationDestinationDecision } from "../actions/move-specials";
import { drawCard, DrawUnavailableError } from "../cards/draw-card";
import { legalAttackSwarms, mechanicallyDistinctSlainCards, slayMarine } from "../combat/attack";
import { advanceAutomatic, newGame, submitDecision } from "../controller";
import { Sha256CounterRng } from "../rng/sha256-counter";
import type { GameState } from "../state/game-state";
import { discardOldTerrain, placeLocationTerrain, replaceTerrainDefinition } from "../travel/location";
import { assertStateInvariants } from "../validation/invariants";

const TEAMS = ["GREEN", "YELLOW", "RED"] as const;

function baseState(label: string): GameState {
  return structuredClone(newGame({ gameId: `cert.${label}`, seed: `cert-${label}`, teamColors: TEAMS }).state);
}

function forceEvent(state: GameState, definitionId: string): string {
  const cardId = Object.values(state.components).find((component) => component.kind === "EVENT" && component.definitionId === definitionId)!.instanceId;
  for (const source of ["event.deck", "event.discard"] as const) state.orderedSources[source] = state.orderedSources[source].filter((id) => id !== cardId);
  state.orderedSources["event.deck"].unshift(cardId);
  state.components[cardId].zone = "DECK";
  state.components[cardId].containerId = "event.deck";
  state.phase = "EVENT";
  state.pendingDecision = null;
  state.pendingQueue = [];
  return cardId;
}

function emptyBlip(state: GameState, side: "LEFT" | "RIGHT"): void {
  const source = side === "LEFT" ? "blip.left" : "blip.right";
  for (const cardId of state.orderedSources[source]) {
    state.orderedSources["genestealer.discard"].push(cardId);
    state.components[cardId].zone = "DISCARD";
    state.components[cardId].containerId = "genestealer.discard";
  }
  state.orderedSources[source] = [];
}

describe("v1.4 constructed certification regressions", () => {
  it("REG1 resolves Overwatch before Event travel and cleanup", () => {
    const state = baseState("reg1");
    forceEvent(state, "event.chaos-of-battle");
    emptyBlip(state, "LEFT");
    expect(state.formation.some((slot) => legalAttackSwarms(state, slot.marineInstanceId).length > 0)).toBe(true);
    const targets = state.formation.map((slot) => slot.marineInstanceId);
    for (const marineId of targets) { state.marines[marineId].support += 1; state.supportSupply -= 1; }
    state.roundEffects.push({ id: "cert.reg1.overwatch", sourceId: "action.red.overwatch", startTiming: "ACTION_RESOLVED", expiryTiming: "END_OF_ROUND", targetIds: targets, mergePropagation: "NONE", data: { handlerId: "action.overwatch" } });

    let result = advanceAutomatic(state);
    expect(result.state.pendingDecision?.type).toBe("EVENT_REVEAL_ACK");
    result = submitDecision(result.state, result.state.pendingDecision!.id, "begin");
    expect(result.state.pendingDecision?.type).toBe("EVENT_MOVEMENT_ACK");
    expect(result.state.travelRuntime).toBeNull();
    expect(result.state.eventStep).toBe("MOVEMENT_PREP");
    result = submitDecision(result.state, result.state.pendingDecision!.id, "begin");
    expect(result.state.pendingDecision?.type).toBe("EVENT_ATTACK");
    expect(result.state.eventStep).toBe("END_EFFECTS");
    result = submitDecision(result.state, result.state.pendingDecision!.id, "finish");
    const types = result.transitions.map((transition) => transition.type);
    expect(types.indexOf("EVENT_DECISION_RESOLVED")).toBeLessThan(types.indexOf("TRAVEL_STARTED"));
    expect(types).not.toContain("ROUND_ENDED");
  });

  it("REG5 completes a Control Panel handler before Intimidation begins", () => {
    let result = newGame({ gameId: "cert.reg5", seed: "cert-reg5", teamColors: ["GREEN", "YELLOW", "BLUE"] });
    const state = structuredClone(result.state);
    const oldLocation = state.currentLocationInstanceId;
    const locationId = "location.maintenance-tunnels";
    for (const source of Object.keys(state.orderedSources)) state.orderedSources[source] = state.orderedSources[source].filter((id) => id !== locationId);
    state.components[oldLocation].zone = "PREVIOUS";
    state.components[locationId].zone = "CURRENT";
    state.components[locationId].containerId = null;
    state.currentLocationInstanceId = locationId;
    if (!state.terrain["terrain.control-panel"]) replaceTerrainDefinition(state, "terrain.corridor", "terrain.control-panel");
    const panel = state.terrain["terrain.control-panel"];
    panel.activatedThisRound = false;
    const blueMarine = state.teams.BLUE.marineInstanceIds[0];
    const blueIndex = state.formation.findIndex((slot) => slot.marineInstanceId === blueMarine);
    const displaced = state.formation[panel.positionIndex].marineInstanceId;
    state.formation[panel.positionIndex].marineInstanceId = blueMarine;
    state.formation[blueIndex].marineInstanceId = displaced;
    state.components[blueMarine].containerId = `formation.${panel.positionIndex}`;
    state.components[displaced].containerId = `formation.${blueIndex}`;
    state.marines[blueMarine].facing = panel.side;
    result = { ...result, state, pendingDecision: state.pendingDecision };

    for (const name of ["Block", "Defensive Stance", "Intimidation"]) {
      const decision = result.state.pendingDecision!;
      const option = decision.legalOptions.find((item) => actionDefinition(item.payload.actionId as string).name === name)!;
      result = submitDecision(result.state, decision.id, option.id);
    }
    const transitions = [...result.transitions];
    const seen: string[] = [];
    let guard = 0;
    while (result.state.pendingDecision?.type !== "INTIMIDATION_ROLL" && guard++ < 40) {
      const decision = result.state.pendingDecision!;
      seen.push(`${decision.type}:${decision.legalOptions.map((item) => item.id).join(",")}`);
      const option = decision.type === "MOVE_MARINE"
        ? decision.legalOptions.find((item) => item.payload.finish)
        : decision.type === "SET_FACING"
          ? decision.legalOptions.find((item) => item.id.startsWith("keep:"))
          : decision.type === "ACTIVATE_TERRAIN"
            ? decision.legalOptions.find((item) => item.payload.terrainId === "terrain.control-panel") ?? decision.legalOptions.find((item) => item.payload.skip)
            : decision.legalOptions[0];
      result = submitDecision(result.state, decision.id, option!.id);
      transitions.push(...result.transitions);
    }
    expect(result.state.pendingDecision?.type).toBe("INTIMIDATION_ROLL");
    const replaced = transitions.findIndex((transition) => transition.type === "TERRAIN_REPLACED");
    const intimidation = transitions.map((transition) => transition.type).lastIndexOf("DECISION_REQUESTED");
    expect(replaced, `${seen.join(" | ")} :: ${transitions.map((transition) => transition.type).join(",")}`).toBeGreaterThanOrEqual(0);
    expect(replaced).toBeLessThan(intimidation);
  });

  it("REG8 clamps every Location Terrain layout for formation sizes 6 through 1", () => {
    for (let size = 6; size >= 1; size -= 1) {
      const state = baseState(`reg8.${size}`);
      while (state.formation.length > size) slayMarine(state, state.formation.at(-1)!.marineInstanceId);
      discardOldTerrain(state);
      placeLocationTerrain(state, "location.main-corridor");
      expect(Object.values(state.terrain)).toHaveLength(4);
      expect(Object.values(state.terrain).every((terrain) => terrain.positionIndex >= 0 && terrain.positionIndex < size)).toBe(true);
      assertStateInvariants(state);
    }
  });

  it("REG9/REG16 reveals a solo Instinct Event before requesting its choice", () => {
    const state = baseState("reg9");
    const cardId = forceEvent(state, "event.surrounded");
    let result = advanceAutomatic(state);
    expect(eventDefinition(cardId).instinct).toBe(true);
    expect(result.state.components[cardId].zone).toBe("RESOLVING");
    expect(result.state.pendingDecision?.type).toBe("EVENT_REVEAL_ACK");
    const revealTransitions = [...result.transitions];
    result = submitDecision(result.state, result.state.pendingDecision!.id, "begin");
    expect(result.state.pendingDecision?.type).toBe("EVENT_MARINE");
    const transitions = [...revealTransitions, ...result.transitions];
    const drawIndex = transitions.findIndex((transition) => transition.type === "CARD_DRAWN" && transition.sourceId === "event.deck");
    const decisionIndex = transitions.map((transition) => transition.type).lastIndexOf("DECISION_REQUESTED");
    expect(drawIndex).toBeGreaterThanOrEqual(0);
    expect(drawIndex).toBeLessThan(decisionIndex);
  });

  it("REG10 collapses mechanically identical slain-card targets", () => {
    const state = baseState("reg10");
    const swarm = Object.values(state.swarms)[0];
    const first = swarm.cardIds[0];
    const duplicate = state.orderedSources["genestealer.deck"].find((id) => state.components[id].definitionId === state.components[first].definitionId)!;
    state.orderedSources["genestealer.deck"] = state.orderedSources["genestealer.deck"].filter((id) => id !== duplicate);
    state.components[duplicate].zone = "SWARM";
    state.components[duplicate].containerId = swarm.id;
    swarm.cardIds.push(duplicate);
    const physical = swarm.cardIds.filter((id) => state.components[id].definitionId === state.components[first].definitionId);
    expect(physical.length).toBeGreaterThan(1);
    expect(mechanicallyDistinctSlainCards(state, swarm.id).filter((id) => state.components[id].definitionId === state.components[first].definitionId)).toHaveLength(1);
  });

  it("REG17 shifts top and bottom deaths into contiguous formations", () => {
    for (const end of ["top", "bottom"] as const) {
      const state = baseState(`reg17.${end}`);
      const before = state.formation.map((slot) => slot.marineInstanceId);
      const slain = end === "top" ? before[0] : before.at(-1)!;
      slayMarine(state, slain);
      expect(state.formation.map((slot) => slot.marineInstanceId)).toEqual(end === "top" ? before.slice(1) : before.slice(0, -1));
      state.formation.forEach((slot, index) => expect(state.components[slot.marineInstanceId].containerId).toBe(`formation.${index}`));
      assertStateInvariants(state);
    }
  });

  it("REG19 exposes both destinations when the smallest Blip is tied", () => {
    const state = baseState("reg19");
    expect(state.orderedSources["blip.left"]).toHaveLength(state.orderedSources["blip.right"].length);
    const decision = intimidationDestinationDecision(state, "action.blue.intimidation")!;
    expect(decision.legalOptions.map((option) => option.payload.side).sort()).toEqual(["LEFT", "RIGHT"]);
  });

  it("REG20 rebuilds Event/Genestealer decks but never Location or blip sources", () => {
    const state = baseState("reg20");
    const deck = [...state.orderedSources["genestealer.deck"]];
    state.orderedSources["genestealer.deck"] = [];
    state.orderedSources["genestealer.discard"].push(...deck);
    for (const cardId of deck) { state.components[cardId].zone = "DISCARD"; state.components[cardId].containerId = "genestealer.discard"; }
    const rng = Sha256CounterRng.restore(state.rng);
    const rebuilt = drawCard(state, rng, "genestealer.deck", { zone: "DISCARD", containerId: "genestealer.discard" }, (cardId) => state.orderedSources["genestealer.discard"].push(cardId));
    expect(rebuilt.transitions.map((transition) => transition.type)).toEqual(["PILE_SHUFFLED", "CARD_DRAWN"]);
    for (const locationId of state.orderedSources["location.deck"]) { state.components[locationId].zone = "UNUSED"; state.components[locationId].containerId = null; }
    state.orderedSources["location.deck"] = [];
    emptyBlip(state, "LEFT");
    expect(() => drawCard(state, rng, "location.deck", { zone: "CURRENT", containerId: null })).toThrow(DrawUnavailableError);
    expect(() => drawCard(state, rng, "blip.left", { zone: "SWARM", containerId: null })).toThrow(DrawUnavailableError);
  });

  it("REG22 has no independent ordered-source top-card removal path", () => {
    const files = ["src/engine/controller.ts", "src/engine/event/event.ts", "src/engine/setup/new-game.ts", "src/engine/travel/location.ts", "src/engine/actions/move-specials.ts"];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/orderedSources\[[^\]]+\]\.(?:shift|pop)\s*\(/);
      expect(source, file).not.toMatch(/orderedSources\[[^\]]+\]\s*=\s*[^;]*\.slice\(1\)/);
    }
  });
});
