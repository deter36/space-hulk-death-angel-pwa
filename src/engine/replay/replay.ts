import { canonicalStringify, stateHash } from "../state/canonical";
import { advanceAutomatic } from "../controller";
import type { GameState } from "../state/game-state";
import type { DecisionRecord, EngineResult, ReplayPackage, ReplayResult } from "../transitions/types";
import { assertStateInvariants } from "../validation/invariants";

export function serialize(state: GameState): string {
  assertStateInvariants(state);
  return canonicalStringify(state);
}

export function load(serialized: string): GameState {
  const parsed = JSON.parse(serialized) as Partial<GameState>;
  if (parsed.schemaVersion !== "1.0.0" || parsed.canonicalFormatVersion !== "1") throw new TypeError("Unsupported canonical game-state version");
  const state = parsed as GameState;
  assertStateInvariants(state);
  return state;
}

export function replay(
  replayPackage: ReplayPackage,
  submitDecision: (state: GameState, decision: DecisionRecord) => EngineResult,
): ReplayResult {
  if (replayPackage.replayVersion !== "1") throw new TypeError("Unsupported replay version");
  if (replayPackage.engineVersion !== replayPackage.initialState.engineVersion || replayPackage.dataVersion !== replayPackage.initialState.dataVersion) {
    throw new TypeError("Replay package engine/data versions do not match its initial state");
  }
  let state = load(serialize(replayPackage.initialState));
  const transitions = [];
  for (const decision of replayPackage.decisions) {
    while (!state.pendingDecision && state.status === "IN_PROGRESS") {
      const automatic = advanceAutomatic(state);
      if (!automatic.transitions.length) throw new Error(`Replay stalled before ${decision.decisionId}`);
      state = automatic.state;
      transitions.push(...automatic.transitions);
    }
    const result = submitDecision(state, decision);
    state = result.state;
    transitions.push(...result.transitions);
  }
  while (!state.pendingDecision && state.status === "IN_PROGRESS"
    && (replayPackage.expectedTransitionHashes.length > transitions.length
      || (replayPackage.expectedFinalStateHash !== null && replayPackage.expectedFinalStateHash !== stateHash(state)))) {
    const automatic = advanceAutomatic(state);
    if (!automatic.transitions.length) break;
    state = automatic.state;
    transitions.push(...automatic.transitions);
  }
  const transitionHashes = transitions.map((transition) => transition.postStateHash);
  if (replayPackage.expectedTransitionHashes.length && canonicalStringify(transitionHashes) !== canonicalStringify(replayPackage.expectedTransitionHashes)) {
    throw new Error("Replay transition hashes do not match the certified package");
  }
  const finalStateHash = stateHash(state);
  if (replayPackage.expectedFinalStateHash !== null && replayPackage.expectedFinalStateHash !== finalStateHash) {
    throw new Error("Replay final state hash does not match the certified package");
  }
  return { state, transitions, finalStateHash };
}
