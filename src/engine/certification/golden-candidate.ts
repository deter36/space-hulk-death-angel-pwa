import { advanceAutomatic, newGame, submitDecision } from "../controller";
import { stateHash } from "../state/canonical";
import type { DecisionRecord, ReplayPackage, TransitionRecord } from "../transitions/types";
import { certificationOption } from "./solo-policy";

export const GOLDEN_CONFIG = { gameId: "golden.solo.passive-v1", seed: "death-angel-golden-passive-v1", teamColors: ["GREEN", "YELLOW", "RED"] as const };

export function buildGoldenCandidate() {
  const setup = newGame(GOLDEN_CONFIG);
  const initialState = structuredClone(setup.state);
  let state = setup.state;
  const decisions: DecisionRecord[] = [];
  const transitions: TransitionRecord[] = [];
  let guard = 0;

  while (state.status === "IN_PROGRESS" && guard++ < 5000) {
    if (!state.pendingDecision) {
      const automatic = advanceAutomatic(state);
      if (!automatic.transitions.length) throw new Error(`Certification stalled in ${state.phase}`);
      state = automatic.state;
      transitions.push(...automatic.transitions);
      continue;
    }
    const decisionId = state.pendingDecision.id;
    const optionId = certificationOption(state);
    const record: DecisionRecord = { decisionId, optionId, transitionSeq: state.transitionSeq + 1 };
    const result = submitDecision(state, decisionId, optionId);
    decisions.push(record);
    transitions.push(...result.transitions);
    state = result.state;
  }
  if (guard >= 5000) throw new Error("Certification decision guard exhausted");
  const replayPackage: ReplayPackage = {
    replayVersion: "1",
    engineVersion: initialState.engineVersion,
    dataVersion: initialState.dataVersion,
    initialState,
    decisions,
    expectedTransitionHashes: transitions.map((transition) => transition.postStateHash),
    expectedFinalStateHash: stateHash(state),
  };
  return { initialState, state, decisions, transitions, replayPackage };
}
