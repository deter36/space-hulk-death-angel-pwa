import { advanceAutomatic, newGame, submitDecision, type NewGameConfig } from "../controller";
import { canonicalStringify, stateHash } from "../state/canonical";
import type { GameState } from "../state/game-state";
import type { DecisionRecord, EngineResult, TransitionRecord } from "../transitions/types";
import { load, serialize } from "../replay/replay";

export type EngineSessionMode = "PLAYER" | "TEST" | "CERTIFIED_REPLAY";
export type CertificationStatus = "ELIGIBLE" | "NON_CERTIFIABLE";

export type UndoCheckpoint = {
  serializedState: string;
  decisionLength: number;
  transitionLength: number;
  decisionId: string;
  crossedBarrier: boolean;
};

export type UndoAuditEntry = {
  sequence: number;
  mode: EngineSessionMode;
  steps: number;
  crossedBarrier: boolean;
  abandonedDecisionIds: string[];
  fromStateHash: string;
  toStateHash: string;
};

export type LastUndoBarrier = {
  transitionSeq: number;
  reason: "RANDOMNESS" | "HIDDEN_INFORMATION";
};

export type UndoStatus = {
  allowed: boolean;
  availableSteps: number;
  unavailableReason: "CERTIFIED_REPLAY" | "RANDOMNESS_BARRIER" | "HIDDEN_INFORMATION_BARRIER" | "NO_HISTORY" | null;
};

export type EngineSession = {
  sessionVersion: "1";
  mode: EngineSessionMode;
  certification: CertificationStatus;
  state: GameState;
  decisions: DecisionRecord[];
  transitions: TransitionRecord[];
  undoStack: UndoCheckpoint[];
  undoAudit: UndoAuditEntry[];
  lastUndoBarrier: LastUndoBarrier | null;
};

export type DecisionExecutor = (state: GameState, decisionId: string, optionId: string) => EngineResult;

export function newEngineSession(config: NewGameConfig, mode: EngineSessionMode = "PLAYER"): EngineSession {
  return engineSessionFromResult(newGame(config), mode);
}

export function engineSessionFromResult(result: EngineResult, mode: EngineSessionMode = "PLAYER"): EngineSession {
  const lastBarrier = findLastBarrier(result.transitions);
  return {
    sessionVersion: "1",
    mode,
    certification: "ELIGIBLE",
    state: structuredClone(result.state),
    decisions: [],
    transitions: structuredClone(result.transitions),
    undoStack: [],
    undoAudit: [],
    lastUndoBarrier: lastBarrier,
  };
}

export function submitSessionDecision(
  input: EngineSession,
  decisionId: string,
  optionId: string,
  executor: DecisionExecutor = submitDecision,
): EngineSession {
  const session = cloneSession(input);
  const pending = session.state.pendingDecision;
  if (!pending || pending.id !== decisionId) throw new TypeError(`Stale or unknown session decision: ${decisionId}`);
  if (!pending.legalOptions.some((option) => option.id === optionId)) throw new TypeError(`Illegal session option: ${optionId}`);

  const checkpoint: UndoCheckpoint = {
    serializedState: serialize(session.state),
    decisionLength: session.decisions.length,
    transitionLength: session.transitions.length,
    decisionId,
    crossedBarrier: false,
  };
  const decision: DecisionRecord = { decisionId, optionId, transitionSeq: session.state.transitionSeq + 1 };
  const result = executor(session.state, decisionId, optionId);
  const barrier = findLastBarrier(result.transitions);
  checkpoint.crossedBarrier = barrier !== null;
  session.state = result.state;
  session.decisions.push(decision);
  session.transitions.push(...result.transitions);
  if (barrier) session.lastUndoBarrier = barrier;

  if (session.mode === "PLAYER") {
    if (barrier) session.undoStack = [];
    else session.undoStack.push(checkpoint);
  } else if (session.mode === "TEST") {
    session.undoStack.push(checkpoint);
  }
  return session;
}

export function advanceSessionAutomatic(input: EngineSession): EngineSession {
  const session = cloneSession(input);
  const result = advanceAutomatic(session.state);
  const barrier = findLastBarrier(result.transitions);
  session.state = result.state;
  session.transitions.push(...result.transitions);
  if (barrier) {
    session.lastUndoBarrier = barrier;
    if (session.mode === "PLAYER") session.undoStack = [];
  }
  return session;
}

export function canUndo(session: EngineSession): boolean {
  return session.mode !== "CERTIFIED_REPLAY" && session.undoStack.length > 0;
}

export function getUndoStatus(session: EngineSession): UndoStatus {
  if (session.mode === "CERTIFIED_REPLAY") return { allowed: false, availableSteps: 0, unavailableReason: "CERTIFIED_REPLAY" };
  if (session.undoStack.length) return { allowed: true, availableSteps: session.undoStack.length, unavailableReason: null };
  if (session.lastUndoBarrier?.reason === "RANDOMNESS") return { allowed: false, availableSteps: 0, unavailableReason: "RANDOMNESS_BARRIER" };
  if (session.lastUndoBarrier?.reason === "HIDDEN_INFORMATION") return { allowed: false, availableSteps: 0, unavailableReason: "HIDDEN_INFORMATION_BARRIER" };
  return { allowed: false, availableSteps: 0, unavailableReason: "NO_HISTORY" };
}

export function undo(sessionInput: EngineSession, steps = 1): EngineSession {
  if (sessionInput.mode === "CERTIFIED_REPLAY") throw new Error("Undo is disabled during certified replay");
  if (!Number.isSafeInteger(steps) || steps < 1) throw new RangeError("Undo steps must be a positive integer");
  if (steps > sessionInput.undoStack.length) throw new RangeError("Undo cannot cross the latest permitted history boundary");

  const session = cloneSession(sessionInput);
  const removed = session.undoStack.slice(-steps);
  const target = removed[0];
  const fromStateHash = stateHash(session.state);
  const abandonedDecisionIds = session.decisions.slice(target.decisionLength).map((decision) => decision.decisionId);
  session.state = load(target.serializedState);
  session.decisions = session.decisions.slice(0, target.decisionLength);
  session.transitions = session.transitions.slice(0, target.transitionLength);
  session.undoStack = session.undoStack.slice(0, -steps);
  const crossedBarrier = removed.some((checkpoint) => checkpoint.crossedBarrier);
  if (crossedBarrier) session.certification = "NON_CERTIFIABLE";
  session.undoAudit.push({
    sequence: session.undoAudit.length + 1,
    mode: session.mode,
    steps,
    crossedBarrier,
    abandonedDecisionIds,
    fromStateHash,
    toStateHash: stateHash(session.state),
  });
  return session;
}

export function serializeEngineSession(session: EngineSession): string {
  validateSession(session);
  return canonicalStringify(session);
}

export function loadEngineSession(serialized: string): EngineSession {
  const session = JSON.parse(serialized) as EngineSession;
  validateSession(session);
  return session;
}

export function hasUndoBarrier(transitions: readonly TransitionRecord[]): boolean {
  return transitions.some((transition) => transition.undoBarrier !== null);
}

function findLastBarrier(transitions: readonly TransitionRecord[]): LastUndoBarrier | null {
  for (let index = transitions.length - 1; index >= 0; index -= 1) {
    const transition = transitions[index];
    if (transition.undoBarrier) return { transitionSeq: transition.seq, reason: transition.undoBarrier };
  }
  return null;
}

function cloneSession(session: EngineSession): EngineSession {
  return structuredClone(session);
}

function validateSession(session: EngineSession): void {
  if (session.sessionVersion !== "1") throw new TypeError("Unsupported engine-session version");
  if (!(["PLAYER", "TEST", "CERTIFIED_REPLAY"] as string[]).includes(session.mode)) throw new TypeError("Invalid engine-session mode");
  if (!(["ELIGIBLE", "NON_CERTIFIABLE"] as string[]).includes(session.certification)) throw new TypeError("Invalid certification status");
  load(serialize(session.state));
  for (const checkpoint of session.undoStack) load(checkpoint.serializedState);
  for (const checkpoint of session.undoStack) {
    if (checkpoint.decisionLength > session.decisions.length || checkpoint.transitionLength > session.transitions.length) throw new TypeError("Undo checkpoint exceeds active session history");
  }
  if (session.mode === "CERTIFIED_REPLAY" && session.undoStack.length) throw new TypeError("Certified replay sessions cannot contain undo history");
}
