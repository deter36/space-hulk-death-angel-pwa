export { newGame, advanceAutomatic, submitDecision, type NewGameConfig } from "./controller";
export { serialize, load, replay } from "./replay/replay";
export { stateHash, canonicalStringify } from "./state/canonical";
export { assertStateInvariants, validateState } from "./validation/invariants";
export type { GameState, PendingDecision } from "./state/game-state";
export type { DecisionRecord, EngineResult, ReplayPackage, ReplayResult, TransitionRecord } from "./transitions/types";
export { actionSelectionView, type ActionCardView, type ActionSelectionView } from "../ui-adapter/action-selection";
export {
  newEngineSession,
  engineSessionFromResult,
  submitSessionDecision,
  advanceSessionAutomatic,
  canUndo,
  getUndoStatus,
  undo,
  serializeEngineSession,
  loadEngineSession,
  hasUndoBarrier,
  type EngineSession,
  type EngineSessionMode,
  type CertificationStatus,
  type UndoStatus,
} from "./session/engine-session";
