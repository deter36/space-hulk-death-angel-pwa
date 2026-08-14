import { stateHash } from "../state/canonical";
import type { GameState } from "../state/game-state";
import { assertStateInvariants } from "../validation/invariants";
import type { DecisionRecord, MutationRecord, RandomRecord, TransitionRecord } from "./types";

export function commitTransition(
  state: GameState,
  type: string,
  sourceId: string | null,
  mutate: () => void,
  options: {
    randomInputs?: RandomRecord[];
    mutations?: MutationRecord[];
    playerDecision?: DecisionRecord | null;
    generatedCheckpoints?: string[];
    undoBarrier?: "RANDOMNESS" | "HIDDEN_INFORMATION" | null;
  } = {},
): TransitionRecord {
  const preStateHash = stateHash(state);
  mutate();
  state.transitionSeq += 1;
  assertStateInvariants(state);
  const randomInputs = options.randomInputs ?? [];
  return {
    seq: state.transitionSeq,
    type,
    sourceId,
    preStateHash,
    randomInputs,
    playerDecision: options.playerDecision ?? null,
    mutations: options.mutations ?? [],
    postStateHash: stateHash(state),
    generatedCheckpoints: options.generatedCheckpoints ?? [],
    undoBarrier: options.undoBarrier ?? (randomInputs.length ? "RANDOMNESS" : null),
  };
}
