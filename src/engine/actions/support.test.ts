import { describe, expect, it } from "vitest";
import { actionDefinition, MARINES } from "./catalog";
import { advanceAutomatic, newGame, submitDecision } from "../controller";
import type { EngineResult } from "../transitions/types";
import { assertStateInvariants } from "../validation/invariants";
import { actionSelectionView } from "../../ui-adapter/action-selection";
import { replay } from "../replay/replay";
import { stateHash } from "../state/canonical";
import type { DecisionRecord, TransitionRecord } from "../transitions/types";

const CONFIG = { gameId: "game.actions", seed: "DA-actions-v1", teamColors: ["GREEN", "YELLOW", "RED"] as const };

function chooseAction(result: EngineResult, actionName: string): EngineResult {
  const decision = result.state.pendingDecision!;
  expect(decision.type).toBe("CHOOSE_ACTION");
  const option = decision.legalOptions.find((candidate) => actionDefinition(candidate.payload.actionId as string).name === actionName)!;
  return submitDecision(result.state, decision.id, option.id);
}

function placeSupport(result: EngineResult, marineId?: string): EngineResult {
  const decision = result.state.pendingDecision!;
  expect(decision.type).toBe("PLACE_SUPPORT");
  const option = marineId ? decision.legalOptions.find((candidate) => candidate.payload.marineId === marineId)! : decision.legalOptions[0];
  return submitDecision(result.state, decision.id, option.id);
}

describe("Action selection and Support actions", () => {
  it("locks one player-selected Action per team and resolves by initiative", () => {
    let result = newGame(CONFIG);
    result = chooseAction(result, "Block");
    result = chooseAction(result, "Defensive Stance");
    result = chooseAction(result, "Overwatch");

    expect(result.state.phase).toBe("RESOLVE_ACTIONS");
    expect(result.state.actionQueue).toEqual(["action.green.block", "action.yellow.defensive-stance", "action.red.overwatch"]);
    expect(result.state.currentPlayerTeam).toBe("GREEN");
    expect(result.state.pendingDecision?.type).toBe("PLACE_SUPPORT");

    const recipients: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      recipients.push(result.state.pendingDecision!.legalOptions[0].payload.marineId as string);
      result = placeSupport(result);
    }
    expect(result.state.phase).toBe("GENESTEALER_ATTACK");
    expect(result.state.supportSupply).toBe(9);
    expect(recipients.every((id) => result.state.marines[id].support >= 1)).toBe(true);
    expect(result.state.roundEffects.map((effect) => effect.data.handlerId)).toEqual([
      "action.block", "action.defensive-stance", "action.overwatch",
    ]);
    expect(result.state.teams.GREEN.previousActionInstanceId).toBe("action.green.block");
    expect(result.state.teams.YELLOW.previousActionInstanceId).toBe("action.yellow.defensive-stance");
    expect(result.state.teams.RED.previousActionInstanceId).toBe("action.red.overwatch");
    assertStateInvariants(result.state);
  });

  it("offers any live Marine as the Support recipient", () => {
    let result = newGame(CONFIG);
    result = chooseAction(result, "Block");
    result = chooseAction(result, "Defensive Stance");
    result = chooseAction(result, "Overwatch");
    expect(result.state.pendingDecision?.legalOptions).toHaveLength(6);
    const redMarine = result.state.teams.RED.marineInstanceIds.find((id) => result.state.marines[id])!;
    result = placeSupport(result, redMarine);
    expect(result.state.marines[redMarine].support).toBe(1);
  });

  it("targets the named Marines for Block and Counter Attack", () => {
    let result = newGame({ gameId: "game.named-support", seed: "DA-named-support", teamColors: ["GREEN", "YELLOW", "BLUE"] });
    result = chooseAction(result, "Block");
    result = chooseAction(result, "Defensive Stance");
    result = chooseAction(result, "Counter Attack");
    result = placeSupport(result);
    result = placeSupport(result);
    result = placeSupport(result);
    const effectByHandler = new Map(result.state.roundEffects.map((effect) => [effect.data.handlerId, effect]));
    expect(effectByHandler.get("action.block")?.targetIds).toEqual([MARINES.find((marine) => marine.name === "Sergeant Gideon")!.id]);
    expect(effectByHandler.get("action.counter-attack")?.targetIds).toEqual([MARINES.find((marine) => marine.name === "Sergeant Lorenzo")!.id]);
  });

  it("rejects stale and fabricated decisions", () => {
    const result = newGame(CONFIG);
    const decision = result.state.pendingDecision!;
    expect(() => submitDecision(result.state, "decision.fake", decision.legalOptions[0].id)).toThrow(/Stale/);
    expect(() => submitDecision(result.state, decision.id, "action:fake")).toThrow(/Illegal option/);
  });

  it("excludes the previous round's Action", () => {
    const result = newGame(CONFIG);
    const state = structuredClone(result.state);
    state.pendingDecision = null;
    state.pendingQueue = [];
    state.teams.GREEN.previousActionInstanceId = "action.green.block";
    const advanced = advanceAutomatic(state);
    expect(advanced.state.pendingDecision?.legalOptions.map((option) => option.payload.actionId)).not.toContain("action.green.block");
    expect(advanced.state.pendingDecision?.legalOptions).toHaveLength(2);
    const view = actionSelectionView(advanced.state)!;
    expect(view.cards).toHaveLength(3);
    expect(view.cards.find((card) => card.name === "Block")).toMatchObject({ available: false, unavailableReason: "PREVIOUS_ROUND", optionId: null });
  });

  it("replays the same Action and Support decisions to identical transitions and state", () => {
    const initial = newGame(CONFIG).state;
    let state = initial;
    const decisions: DecisionRecord[] = [];
    const transitions: TransitionRecord[] = [];
    const submit = (optionId: string) => {
      const pending = state.pendingDecision!;
      const record = { decisionId: pending.id, optionId, transitionSeq: state.transitionSeq + 1 };
      decisions.push(record);
      const result = submitDecision(state, record.decisionId, record.optionId);
      state = result.state;
      transitions.push(...result.transitions);
    };
    for (const name of ["Block", "Defensive Stance", "Overwatch"]) {
      const pending = state.pendingDecision!;
      submit(pending.legalOptions.find((option) => actionDefinition(option.payload.actionId as string).name === name)!.id);
    }
    while (state.pendingDecision?.type === "PLACE_SUPPORT") submit(state.pendingDecision.legalOptions[0].id);

    const result = replay({
      replayVersion: "1",
      engineVersion: initial.engineVersion,
      dataVersion: initial.dataVersion,
      initialState: initial,
      decisions,
      expectedTransitionHashes: transitions.map((transition) => transition.postStateHash),
      expectedFinalStateHash: stateHash(state),
    }, (replayState, decision) => submitDecision(replayState, decision.decisionId, decision.optionId));
    expect(result.finalStateHash).toBe(stateHash(state));
    expect(result.transitions).toEqual(transitions);
  });

  it("still registers the card ability when the Support supply is empty", () => {
    let result = newGame(CONFIG);
    const state = structuredClone(result.state);
    const holder = state.formation[0].marineInstanceId;
    state.marines[holder].support = 12;
    state.supportSupply = 0;
    result = { state, transitions: [], pendingDecision: state.pendingDecision };
    result = chooseAction(result, "Block");
    result = chooseAction(result, "Defensive Stance");
    result = chooseAction(result, "Overwatch");
    expect(result.state.pendingDecision).toBeNull();
    expect(result.state.phase).toBe("GENESTEALER_ATTACK");
    expect(result.state.roundEffects).toHaveLength(3);
    expect(result.transitions.filter((transition) => transition.type === "SUPPORT_PLACEMENT_SKIPPED")).toHaveLength(3);
    expect(result.state.marines[holder].support).toBe(12);
  });

  it("resolves Strategize movement/merge before the Action completes and applies Power Field", () => {
    let result = newGame({ gameId: "game.support-specials", seed: "DA-support-specials", teamColors: ["GREEN", "PURPLE", "GREY"] });
    result = chooseAction(result, "Block");
    result = chooseAction(result, "Strategize");
    result = chooseAction(result, "Power Field");
    result = placeSupport(result);
    result = placeSupport(result);

    const strategize = result.state.pendingDecision!;
    expect(strategize.type).toBe("STRATEGIZE");
    const move = strategize.legalOptions.find((option) => !option.payload.skip)!;
    const movedSwarmId = move.payload.swarmId as string;
    result = submitDecision(result.state, strategize.id, move.id);
    expect(result.transitions.map((transition) => transition.type)).toContain("SWARMS_MERGED");
    expect(result.state.swarms[movedSwarmId]).toBeDefined();

    result = placeSupport(result);
    const powerField = result.state.pendingDecision!;
    expect(powerField.type).toBe("POWER_FIELD");
    const target = powerField.legalOptions.find((option) => !option.payload.skip)!;
    const protectedSwarmId = target.payload.swarmId as string;
    result = submitDecision(result.state, powerField.id, target.id);
    expect(result.state.phase).toBe("GENESTEALER_ATTACK");
    expect(result.state.swarms[protectedSwarmId].effects).toEqual([
      expect.objectContaining({
        sourceId: "action.grey.power-field",
        expiryTiming: "END_OF_ROUND",
        mergePropagation: "WHOLE_MERGED_SWARM",
        data: { cannotAttack: true, cannotBeSlain: true },
      }),
    ]);
    assertStateInvariants(result.state);
  });
});
