import type { GameState, PendingDecision, RngState } from "../state/game-state";

export type RandomRecord = {
  operationSeq: number;
  kind: "SHUFFLE" | "DRAW" | "DIE";
  sourceId: string;
  cardId: string | null;
  preLength: number | null;
  postLength: number | null;
  resultingRng: RngState;
};

export type MutationRecord = {
  path: string;
  operation: "SET" | "MOVE" | "APPEND" | "REMOVE";
  value: string | number | boolean | null;
};

export type DecisionRecord = {
  decisionId: string;
  optionId: string;
  transitionSeq: number;
};

export type TransitionRecord = {
  seq: number;
  type: string;
  sourceId: string | null;
  preStateHash: string;
  randomInputs: RandomRecord[];
  playerDecision: DecisionRecord | null;
  mutations: MutationRecord[];
  postStateHash: string;
  generatedCheckpoints: string[];
  undoBarrier: "RANDOMNESS" | "HIDDEN_INFORMATION" | null;
};

export type EngineResult = {
  state: GameState;
  transitions: TransitionRecord[];
  pendingDecision: PendingDecision | null;
};

export type ReplayPackage = {
  replayVersion: "1";
  engineVersion: string;
  dataVersion: string;
  initialState: GameState;
  decisions: DecisionRecord[];
  expectedTransitionHashes: string[];
  expectedFinalStateHash: string | null;
};

export type ReplayResult = {
  state: GameState;
  transitions: TransitionRecord[];
  finalStateHash: string;
};
