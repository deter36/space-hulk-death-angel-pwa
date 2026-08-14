import { describe, expect, it } from "vitest";
import { actionDefinition } from "../actions/catalog";
import { submitDecision } from "../controller";
import { stateHash } from "../state/canonical";
import type { EngineResult } from "../transitions/types";
import {
  canUndo,
  getUndoStatus,
  hasUndoBarrier,
  loadEngineSession,
  newEngineSession,
  serializeEngineSession,
  submitSessionDecision,
  undo,
  type DecisionExecutor,
  type EngineSession,
} from "./engine-session";

const CONFIG = { gameId: "game.undo", seed: "DA-undo-v1", teamColors: ["GREEN", "YELLOW", "RED"] as const };

function actionOption(session: EngineSession, name: string): string {
  return session.state.pendingDecision!.legalOptions.find((option) => actionDefinition(option.payload.actionId as string).name === name)!.id;
}

function submitAction(session: EngineSession, name: string, executor?: DecisionExecutor): EngineSession {
  const decision = session.state.pendingDecision!;
  return submitSessionDecision(session, decision.id, actionOption(session, name), executor);
}

const randomnessExecutor: DecisionExecutor = (state, decisionId, optionId): EngineResult => {
  const result = submitDecision(state, decisionId, optionId);
  result.transitions[result.transitions.length - 1].undoBarrier = "RANDOMNESS";
  return result;
};

describe("engine session undo", () => {
  it("restores multiple safe player decisions and replaces the active replay branch", () => {
    const initial = newEngineSession(CONFIG, "PLAYER");
    const initialHash = stateHash(initial.state);
    let session = submitAction(initial, "Block");
    const staleYellowDecision = session.state.pendingDecision!.id;
    session = submitAction(session, "Defensive Stance");
    expect(canUndo(session)).toBe(true);
    expect(session.decisions).toHaveLength(2);

    session = undo(session, 2);
    expect(stateHash(session.state)).toBe(initialHash);
    expect(session.decisions).toHaveLength(0);
    expect(session.certification).toBe("ELIGIBLE");
    expect(session.undoAudit[0]).toMatchObject({ steps: 2, crossedBarrier: false });
    expect(() => submitSessionDecision(session, staleYellowDecision, "anything")).toThrow(/Stale/);

    session = submitAction(session, "Run and Gun");
    expect(session.decisions).toHaveLength(1);
    expect(session.state.teams.GREEN.chosenActionInstanceId).toBe("action.green.run-and-gun");
  });

  it("restores Support supply and recipient state exactly", () => {
    let session = newEngineSession(CONFIG, "PLAYER");
    session = submitAction(session, "Block");
    session = submitAction(session, "Defensive Stance");
    session = submitAction(session, "Overwatch");
    const placement = session.state.pendingDecision!;
    const marineId = placement.legalOptions[0].payload.marineId as string;
    const beforeHash = stateHash(session.state);
    session = submitSessionDecision(session, placement.id, placement.legalOptions[0].id);
    expect(session.state.supportSupply).toBe(11);
    expect(session.state.marines[marineId].support).toBe(1);

    session = undo(session);
    expect(stateHash(session.state)).toBe(beforeHash);
    expect(session.state.supportSupply).toBe(12);
    expect(session.state.marines[marineId].support).toBe(0);
    expect(session.state.pendingDecision?.type).toBe("PLACE_SUPPORT");
  });

  it("clears player undo history when randomness occurs", () => {
    let session = newEngineSession(CONFIG, "PLAYER");
    session = submitAction(session, "Block");
    expect(canUndo(session)).toBe(true);
    session = submitAction(session, "Defensive Stance", randomnessExecutor);
    expect(canUndo(session)).toBe(false);
    expect(getUndoStatus(session)).toMatchObject({ allowed: false, unavailableReason: "RANDOMNESS_BARRIER" });
    expect(session.undoStack).toHaveLength(0);
    expect(session.lastUndoBarrier?.reason).toBe("RANDOMNESS");
    expect(() => undo(session)).toThrow(/latest permitted history boundary/);
  });

  it("allows test mode to cross randomness but invalidates certification", () => {
    let session = newEngineSession(CONFIG, "TEST");
    session = submitAction(session, "Block");
    session = submitAction(session, "Defensive Stance", randomnessExecutor);
    expect(session.undoStack).toHaveLength(2);
    session = undo(session);
    expect(session.certification).toBe("NON_CERTIFIABLE");
    expect(session.undoAudit.at(-1)).toMatchObject({ crossedBarrier: true, mode: "TEST" });
    expect(session.state.pendingDecision?.sourceId).toBe("team.yellow");
  });

  it("disables undo in certified replay mode", () => {
    const session = newEngineSession(CONFIG, "CERTIFIED_REPLAY");
    expect(canUndo(session)).toBe(false);
    expect(getUndoStatus(session).unavailableReason).toBe("CERTIFIED_REPLAY");
    expect(() => undo(session)).toThrow(/disabled/);
  });

  it("persists session history outside canonical GameState", () => {
    let session = newEngineSession(CONFIG, "PLAYER");
    session = submitAction(session, "Block");
    const serialized = serializeEngineSession(session);
    const loaded = loadEngineSession(serialized);
    expect(serializeEngineSession(loaded)).toBe(serialized);
    expect(loaded.undoStack).toHaveLength(1);
    expect(loaded.state).not.toHaveProperty("undoStack");
  });

  it("recognizes both randomness and explicit hidden-information barriers", () => {
    const transition = newEngineSession(CONFIG).transitions.at(-1)!;
    expect(hasUndoBarrier([{ ...transition, undoBarrier: null }])).toBe(false);
    expect(hasUndoBarrier([{ ...transition, undoBarrier: "RANDOMNESS" }])).toBe(true);
    expect(hasUndoBarrier([{ ...transition, undoBarrier: "HIDDEN_INFORMATION" }])).toBe(true);
  });
});
