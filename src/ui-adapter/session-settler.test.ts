import { describe, expect, it } from "vitest";
import { newEngineSession, submitSessionDecision, type EngineSession } from "../engine";
import { EngineSessionStallError, settleEngineSession } from "./session-settler";

function reachAutomaticBoundary(): EngineSession {
  let session = newEngineSession({
    gameId: "ui-boundary-regression",
    seed: "ui-boundary-regression",
    teamColors: ["GREEN", "BLUE", "RED"],
  });

  for (let decisionCount = 0; decisionCount < 200; decisionCount += 1) {
    const decision = session.state.pendingDecision;
    if (!decision) return session;
    session = submitSessionDecision(session, decision.id, decision.legalOptions[0].id);
  }

  throw new Error("Did not reach an automatic boundary");
}

describe("settleEngineSession", () => {
  it("continues a session that yielded at an automatic phase boundary", () => {
    const boundary = reachAutomaticBoundary();

    expect(boundary.state.status).toBe("IN_PROGRESS");
    expect(boundary.state.pendingDecision).toBeNull();

    const settled = settleEngineSession(boundary);

    expect(settled.transitions.length).toBeGreaterThan(boundary.transitions.length);
    expect(settled.state.status !== "IN_PROGRESS" || settled.state.pendingDecision).toBeTruthy();
  });

  it("reports a bounded diagnostic error if automatic processing cannot progress", () => {
    const session = reachAutomaticBoundary();
    const invalidPhase = "UNRECOGNIZED_PHASE" as unknown as EngineSession["state"]["phase"];
    const stalled = structuredClone(session);
    stalled.state.phase = invalidPhase;

    expect(() => settleEngineSession(stalled)).toThrow(EngineSessionStallError);
  });
});
