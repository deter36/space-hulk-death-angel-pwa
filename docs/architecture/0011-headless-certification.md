# ADR 0011: Headless certification and golden replay

Status: Accepted

## Decision

The base-game engine is certified before GUI implementation through two complementary gates: the v1.4 REG1–REG22 constructed regression matrix and a saved deterministic full-game replay package. Certification uses the same controller, decision objects, RNG, ordered sources, and invariant checks as live play.

The committed golden candidate uses a deliberately conservative deterministic solo policy. Strategic quality is outside the certification boundary; the candidate must reach a legal terminal state while preserving exact decisions, transition hashes, hidden source order, RNG state, and final state hash. Its legal defeat is therefore valid certification evidence.

## Replay boundaries

A replay may cross automatic no-decision phase boundaries between recorded decisions. The replay driver advances those boundaries through the canonical controller and records every resulting transition. After the final decision, it advances only when the package's expected transition hashes or final hash require additional automatic work. This supports both partial replays and complete terminal packages without inventing implicit decisions.

## Corrections discovered by certification

- Final-Marine death now canonically removes formation-owned Terrain and swarms instead of leaving orphan runtime state.
- Full Scan discards through `DRAW_CARD`; production code has a static gate against independent ordered-source top-card removal.
- Mechanically indistinguishable slain-card choices collapse to one canonical physical identity.
- Event end-effect bookkeeping is committed inside hash-bearing transitions.

The compatibility change advances the engine version to `0.10.0`. Saves and replay packages retain exact engine/data version checks.
