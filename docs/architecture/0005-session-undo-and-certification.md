# ADR 0005: Session undo boundaries and replay certification

Status: Accepted

## Decision

Undo history belongs to an `EngineSession` outside canonical `GameState`. Each accepted player decision stores the exact serialized pre-decision state and active decision/transition-log lengths. Undo restores that snapshot wholesale and truncates the abandoned active replay branch; it never attempts inverse gameplay mutations.

Three session policies share the same restoration implementation:

- `PLAYER`: may undo any number of accepted player decisions since the latest randomness or hidden-information barrier.
- `TEST`: may undo across any stored decision, including a barrier. Crossing one permanently marks the session `NON_CERTIFIABLE`.
- `CERTIFIED_REPLAY`: disables undo and stores no undo checkpoints.

Every transition carrying random input is automatically marked as a `RANDOMNESS` barrier. A transition that reveals hidden information without random input must explicitly declare a `HIDDEN_INFORMATION` barrier. In player mode, either barrier clears all earlier undo checkpoints immediately. Setup randomness occurs before session undo history begins.

## Persistence and audit

Session serialization includes the current canonical state, active decision and transition logs, undo checkpoints, latest barrier, certification status, and a diagnostic undo audit. The audit may retain abandoned decision IDs, but abandoned transitions and decisions are excluded from the active replay branch.

Undo checkpoints are created per accepted player decision. This supplies fine-grained testing control for Action selection, Support placement, movement, facing, activation, targeting, rerolls, and other future decision categories without placing UI history in canonical gameplay state.

## Safety properties

- Player undo cannot cross a draw, shuffle, die roll, or hidden reveal.
- Test-only barrier crossing cannot produce a certified golden replay.
- Support, ordered piles, RNG state, checkpoints, effects, and component identities restore atomically.
- Decisions from an abandoned future state fail normal pending-decision validation.
- The interface obtains button availability and disabled reason from `getUndoStatus`; it does not infer legality itself.
