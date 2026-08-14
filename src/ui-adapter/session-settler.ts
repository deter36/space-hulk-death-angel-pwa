import { advanceSessionAutomatic, stateHash, type EngineSession } from "../engine";

const DEFAULT_MAX_AUTOMATIC_PASSES = 256;

export class EngineSessionStallError extends Error {
  readonly session: EngineSession;

  constructor(message: string, session: EngineSession) {
    super(message);
    this.name = "EngineSessionStallError";
    this.session = session;
  }
}

export function settleEngineSession(
  input: EngineSession,
  maxAutomaticPasses = DEFAULT_MAX_AUTOMATIC_PASSES,
): EngineSession {
  let session = input;

  for (let pass = 0; pass < maxAutomaticPasses; pass += 1) {
    if (session.state.status !== "IN_PROGRESS" || session.state.pendingDecision) return session;

    const previousHash = stateHash(session.state);
    const previousTransitionCount = session.transitions.length;
    session = advanceSessionAutomatic(session);
    const progressed = session.transitions.length > previousTransitionCount || stateHash(session.state) !== previousHash;

    if (!progressed) {
      throw new EngineSessionStallError(
        `Engine paused without a decision during ${session.state.phase} at transition ${session.state.transitionSeq}. Export diagnostics before starting a new mission.`,
        session,
      );
    }
  }

  throw new EngineSessionStallError(
    `Engine exceeded ${maxAutomaticPasses} automatic passes during ${session.state.phase}. Export diagnostics before starting a new mission.`,
    session,
  );
}
