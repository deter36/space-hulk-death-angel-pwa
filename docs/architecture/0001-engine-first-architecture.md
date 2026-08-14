# ADR 0001: Engine-first web architecture

Status: Accepted

## Decision

The application uses a strict dependency direction:

1. Verified source data is imported into generated runtime data.
2. A framework-independent TypeScript rules engine owns legality and state.
3. An application controller advances the engine until a decision or game end.
4. The React UI renders state and submits only engine-issued legal options.

The UI must not calculate targets, phase progression, card effects, or other gameplay legality independently.

The initial product is solo and base-game only. The state model may retain controller/owner concepts needed for later local multiplayer, but networking is not in scope.

## Web stack

- TypeScript with strict checking
- React through the bundled Vinext/Vite web runtime
- Vitest for engine and regression tests
- Device-local persistence for saves and replay packages
- Progressive Web App packaging after the headless engine is certified

## Consequences

- Rules work can be tested without a browser.
- UI redesigns cannot alter gameplay behavior.
- Every rules bug receives a regression test.
- Card scans and artwork remain outside the gameplay-data pipeline.

