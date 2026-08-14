import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { submitDecision } from "../controller";
import { replay } from "../replay/replay";
import { canonicalStringify, stateHash } from "../state/canonical";
import type { ReplayPackage } from "../transitions/types";
import { assertStateInvariants } from "../validation/invariants";
import { buildGoldenCandidate } from "./golden-candidate";

describe("deterministic full-game certification candidate", () => {
  it("finishes legally and independently replays every transition and hidden source", () => {
    const candidate = buildGoldenCandidate();
    expect(candidate.state.status).not.toBe("IN_PROGRESS");
    expect(candidate.state.phase).toBe("GAME_OVER");
    expect(candidate.decisions.length).toBeGreaterThan(0);
    assertStateInvariants(candidate.state);
    for (let index = 1; index < candidate.transitions.length; index += 1) {
      expect(candidate.transitions[index].preStateHash, `${index}: ${candidate.transitions[index - 1].type} → ${candidate.transitions[index].type}`).toBe(candidate.transitions[index - 1].postStateHash);
    }

    const replayed = replay(candidate.replayPackage, (state, decision) => submitDecision(state, decision.decisionId, decision.optionId));
    expect(replayed.transitions.map((transition) => transition.postStateHash)).toEqual(candidate.transitions.map((transition) => transition.postStateHash));
    expect(replayed.finalStateHash).toBe(stateHash(candidate.state));
    expect(replayed.state.orderedSources).toEqual(candidate.state.orderedSources);
    expect(replayed.state.rng).toEqual(candidate.state.rng);
  });

  it("keeps the committed golden package byte-stable and executable", () => {
    const candidate = buildGoldenCandidate();
    const serialized = readFileSync(resolve("fixtures/golden/solo-passive-v1.json"), "utf8").trim();
    expect(serialized).toBe(canonicalStringify(candidate.replayPackage));
    const replayPackage = JSON.parse(serialized) as ReplayPackage;
    const replayed = replay(replayPackage, (state, decision) => submitDecision(state, decision.decisionId, decision.optionId));
    expect(replayed.state.status).toBe("DEFEAT");
    expect(replayed.finalStateHash).toBe(replayPackage.expectedFinalStateHash);
  });
});
