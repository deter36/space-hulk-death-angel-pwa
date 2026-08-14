# ADR 0003: Canonical serialization and state hashing

Status: Accepted

## Decision

Canonical state is serialized as versioned JSON with these rules:

- Object keys are sorted lexicographically at every depth.
- Array order is preserved because it is often rules-significant.
- Numbers, booleans, strings, and null use JSON semantics.
- Undefined values, UI view models, caches, animations, and diagnostic render state are forbidden from canonical state.
- Transition history is stored beside state rather than inside the hashed state. `transitionSeq` remains part of state.
- A state never contains its own hash.

The state ID is lowercase hexadecimal SHA-256 of the UTF-8 canonical JSON bytes. The serialization format is versioned independently from engine and gameplay-data versions.

The SHA-256 implementation is synchronous, platform-independent TypeScript so the same engine code can run in the offline browser PWA, Cloudflare Worker, and Node test harness without changing results.

## Replay

A replay package contains its initial canonical state, ordered player decisions, engine/data versions, and optional expected transition and final-state hashes. Replay executes through the same engine path as live play.
