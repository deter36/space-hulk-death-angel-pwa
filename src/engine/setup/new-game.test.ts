import { describe, expect, it } from "vitest";
import { drawCard, DrawUnavailableError } from "../cards/draw-card";
import { replay, load, serialize } from "../replay/replay";
import { Sha256CounterRng } from "../rng/sha256-counter";
import { stateHash } from "../state/canonical";
import { assertStateInvariants } from "../validation/invariants";
import { newGame } from "../controller";

const CONFIG = { gameId: "game.setup-regression", seed: "DA-solo-setup-v1", teamColors: ["GREEN", "YELLOW", "RED"] as const };

describe("deterministic solo setup", () => {
  it("builds the complete official solo starting state", () => {
    const result = newGame(CONFIG);
    const { state } = result;
    assertStateInvariants(state);
    expect(state.phase).toBe("CHOOSE_ACTIONS");
    expect(state.round).toBe(1);
    expect(state.activeTeams).toEqual(["GREEN", "YELLOW", "RED"]);
    expect(state.formation).toHaveLength(6);
    expect(state.formation.slice(0, 3).map((slot) => state.marines[slot.marineInstanceId].facing)).toEqual(["LEFT", "LEFT", "LEFT"]);
    expect(state.formation.slice(3).map((slot) => state.marines[slot.marineInstanceId].facing)).toEqual(["RIGHT", "RIGHT", "RIGHT"]);
    expect(Object.keys(state.terrain)).toHaveLength(4);
    expect(state.orderedSources["location.deck"]).toHaveLength(3);
    expect(state.orderedSources["genestealer.deck"]).toHaveLength(24);
    expect(state.orderedSources["event.deck"]).toHaveLength(29);
    expect(state.orderedSources["event.discard"]).toHaveLength(1);
    const blips = state.orderedSources["blip.left"].length + state.orderedSources["blip.right"].length;
    const spawned = Object.values(state.swarms).reduce((sum, swarm) => sum + swarm.cardIds.length, 0);
    expect(blips + spawned).toBe(12);
    expect(state.supportSupply).toBe(12);
    expect(result.transitions.at(-1)?.type).toBe("DECISION_REQUESTED");
    expect(state.pendingDecision?.type).toBe("CHOOSE_ACTION");
    expect(result.transitions.map((transition) => transition.type)).toEqual([
      "GAME_CREATED", "PILE_SHUFFLED", "PILE_SHUFFLED",
      "LOCATION_TIER_SHUFFLED", "LOCATION_TIER_SHUFFLED", "LOCATION_TIER_SHUFFLED",
      "FORMATION_CREATED", "TERRAIN_PLACED",
      ...Array.from({ length: 17 }, () => "CARD_DRAWN"),
      "SETUP_EVENT_DISCARDED", "SETUP_COMPLETED", "DECISION_REQUESTED",
    ]);
    expect(state.rng.operationSeq).toBe(23);
    for (let index = 1; index < result.transitions.length; index += 1) {
      expect(result.transitions[index].preStateHash).toBe(result.transitions[index - 1].postStateHash);
    }
  });

  it("is byte-identical for the same config and survives save/load", () => {
    const first = newGame(CONFIG);
    const second = newGame({ ...CONFIG, teamColors: ["RED", "GREEN", "YELLOW"] });
    expect(serialize(first.state)).toBe(serialize(second.state));
    expect(first.transitions).toEqual(second.transitions);
    const serialized = serialize(first.state);
    expect(serialize(load(serialized))).toBe(serialized);
    expect(stateHash(first.state)).toBe("38080f962fa45c4d4377caa2a3cbd85e19d63557025cf69890005c371a18f7ef");
  });

  it("supports a certified zero-decision replay package", () => {
    const initialState = newGame(CONFIG).state;
    const expectedFinalStateHash = stateHash(initialState);
    const result = replay({
      replayVersion: "1",
      engineVersion: initialState.engineVersion,
      dataVersion: initialState.dataVersion,
      initialState,
      decisions: [],
      expectedTransitionHashes: [],
      expectedFinalStateHash,
    }, () => { throw new Error("No decisions expected"); });
    expect(result.finalStateHash).toBe(expectedFinalStateHash);
  });

  it("rebuilds only legal exhausted sources through DRAW_CARD", () => {
    const state = structuredClone(newGame(CONFIG).state);
    const eventCards = [...state.orderedSources["event.deck"], ...state.orderedSources["event.discard"]];
    state.orderedSources["event.deck"] = [];
    state.orderedSources["event.discard"] = eventCards;
    for (const cardId of eventCards) {
      state.components[cardId].zone = "DISCARD";
      state.components[cardId].containerId = "event.discard";
    }
    const rng = Sha256CounterRng.restore(state.rng);
    const draw = drawCard(state, rng, "event.deck", { zone: "RESOLVING", containerId: null });
    expect(draw.transitions.map((transition) => transition.type)).toEqual(["PILE_SHUFFLED", "CARD_DRAWN"]);
    expect(state.orderedSources["event.deck"]).toHaveLength(29);
    expect(state.orderedSources["event.discard"]).toHaveLength(0);

    const leftCards = state.orderedSources["blip.left"];
    state.orderedSources["blip.left"] = [];
    state.orderedSources["genestealer.discard"].push(...leftCards);
    for (const cardId of leftCards) {
      state.components[cardId].zone = "DISCARD";
      state.components[cardId].containerId = "genestealer.discard";
    }
    expect(() => drawCard(state, rng, "blip.left", { zone: "SWARM", containerId: "swarm.test" }))
      .toThrow(DrawUnavailableError);
  });

  it("rejects invalid team selections", () => {
    expect(() => newGame({ ...CONFIG, teamColors: ["GREEN", "GREEN", "RED"] })).toThrow(/three unique/);
  });

  it("rejects broken Support conservation and duplicate ordered identities", () => {
    const brokenSupport = structuredClone(newGame(CONFIG).state);
    brokenSupport.supportSupply = 11;
    expect(() => assertStateInvariants(brokenSupport)).toThrow(/SUPPORT_CONSERVATION/);

    const duplicate = structuredClone(newGame(CONFIG).state);
    duplicate.orderedSources["genestealer.deck"].push(duplicate.orderedSources["genestealer.deck"][0]);
    expect(() => assertStateInvariants(duplicate)).toThrow(/CARD_DUPLICATE/);
  });
});
