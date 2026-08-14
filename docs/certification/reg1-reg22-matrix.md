# v1.4 REG1–REG22 certification matrix

Status: Automated

Each normative execution regression is tied to executable evidence. Shared invariants run after every committed transition; the paths below identify the primary focused fixture.

| Regression | Certified behavior | Primary automated evidence |
|---|---|---|
| REG1 | Overwatch precedes Event travel and cleanup | `src/engine/certification/constructed-regressions.test.ts` — REG1 |
| REG2 | Repeated legal Support rerolls replace the current result | `src/engine/combat/attack.test.ts` and `defense.test.ts` — repeated Support rerolls |
| REG3 | Marine swaps leave Terrain and swarms with slots | `src/engine/actions/move-activate.test.ts` — Reorganize |
| REG4 | Enter Formation precedes Move + Activate start | `src/engine/event/event.test.ts` — Enter Formation timing |
| REG5 | Control Panel handlers finish before Intimidation post-resolution | `src/engine/travel/control-panel.test.ts` plus `src/engine/actions/move-activate.test.ts` — Control Panels and Intimidation |
| REG6 | Intimidation returns exact selected identities to the smallest Blip | `src/engine/actions/move-activate.test.ts` — Intimidation |
| REG7 | Door resolves before travel replacement and returns Support | `src/engine/travel/location.test.ts` — Door pre-travel window |
| REG8 | Terrain placement clamps for formation sizes 6–1 | `src/engine/certification/constructed-regressions.test.ts` — REG8 |
| REG9 | Solo Instinct is revealed before its choice | `src/engine/certification/constructed-regressions.test.ts` — REG9/REG16 |
| REG10 | Mechanically identical slain-card targets collapse | `src/engine/certification/constructed-regressions.test.ts` — REG10 |
| REG11 | Final Location uses numeric die value independently of skull | `src/engine/travel/control-panel.test.ts` — Launch Control victory |
| REG12 | Immediate victory stops later processing | `src/engine/travel/control-panel.test.ts` and `location.test.ts` — terminal victory paths |
| REG13 | Support total remains 12 | `src/engine/validation/invariants.ts` plus `src/engine/actions/support.test.ts` and travel tests |
| REG14 | Draws require an exact ordered source | `src/engine/setup/new-game.test.ts` — DRAW_CARD unavailable sources |
| REG15 | Same state and decisions reproduce hidden order and hashes | `src/engine/certification/golden-solo.test.ts` |
| REG16 | Solo never uses multiplayer Instinct concealment | `src/engine/certification/constructed-regressions.test.ts` — REG9/REG16 |
| REG17 | Top/bottom deaths leave a contiguous formation | `src/engine/certification/constructed-regressions.test.ts` — REG17 |
| REG18 | Discarded Terrain Support returns before removal | `src/engine/travel/location.test.ts` — Door/travel replacement |
| REG19 | Tied smallest Blips expose both destinations | `src/engine/actions/move-specials.ts` and `src/engine/actions/move-activate.test.ts` — Intimidation destination |
| REG20 | Event/Genestealer decks rebuild; Location/Blips do not | `src/engine/certification/constructed-regressions.test.ts` — REG20 |
| REG21 | SHA-256 counter RNG matches the normative vector | `src/engine/rng/sha256-counter.test.ts` |
| REG22 | Every acquisition uses DRAW_CARD | `src/engine/certification/constructed-regressions.test.ts` — REG22 static path gate |

## Golden candidate

`fixtures/golden/solo-passive-v1.json` is a complete deterministic solo game package. It embeds the canonical post-setup state, the complete player-decision log, every expected post-transition hash, and the expected final state hash. The deliberately conservative certification policy produces a legal defeat; certification concerns deterministic completeness, not strategic quality.
