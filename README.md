# Space Hulk: Death Angel PWA

Mobile-first, deterministic implementation of the base game. The rules engine is the source of truth; the React interface is a projection of canonical state and engine-issued legal decisions.

## Current phase

Phase 10 introduces the first playable mobile GUI on top of the certified engine. Players can choose their three solo teams, inspect Marine, Action, Terrain, Location, Event, and Genestealer information without committing a choice, stage and confirm legal decisions, and use player-safe undo up to the latest randomness or hidden-information barrier.

Phase 9 completed headless certification. The v1.4 REG1–REG22 matrix is tied to executable evidence, and a committed full solo-game package independently replays 45 player decisions and 342 canonical transitions to an exact final hash and hidden-source state.

The complete Event phase, travel, every base-game Location and Control Panel ability, all Action and hostile-attack pipelines, victory and defeat, and official solo setup are implemented in the same canonical engine.

The shared `EngineSession` layer provides player-safe undo up to the latest randomness/hidden-information barrier, unrestricted test undo with certification invalidation, and undo-disabled certified replay. Undo history is session metadata rather than canonical gameplay state.

## Source authority

1. Official FAQ / errata
2. Official rulebook
3. Official card text
4. Verified gameplay database
5. Engine Execution Specification v1.4

Original source files are retained under `docs/source`. Card scans are intentionally excluded.

## Development

```bash
pnpm data:import
pnpm test
pnpm build
pnpm dev
```

Generated runtime data is committed under `src/data/generated`, so production never reads Excel.
