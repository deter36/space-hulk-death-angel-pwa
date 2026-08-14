# ADR 0010: Event phase and next-round effects

Status: Accepted

## Decision

The Event phase is a canonical state machine. It resolves the drawn card's special text first, then its two activation boxes from left to right, movement or flanking, end-of-Event effects, the travel check, and round cleanup. Every card draw, shuffle, and die roll uses the centralized deterministic RNG path and creates the corresponding undo barrier.

Physical Event identity is authoritative. Same-title variants retain separate definition IDs, so the Head and Claw copies of “Out of Thin Air” and the Tail and Tongue copies of “The Swarm” cannot collapse into quantity-only records.

## Spawning and movement

Spawn quantities come from the solo Setup Location. Matching Terrain uses its own side's Blip pile; when supply cannot satisfy multiple matching Terrain cards, the engine emits an explicit priority decision. Core Cogitator caps its selected Terrain during the next Event activation.

Movement is based on swarm contents. A Brood Lord activates on either of its printed icons. Left-side adjacent movement proceeds down the formation and right-side movement proceeds up, independent of Marine facing; movement beyond the formation becomes a flank. The runtime tracks physical card IDs so no Genestealer card moves or flanks twice after swarm merges. Newly spawned cards remain eligible to move.

## Timing and persistence

Overwatch resolves before Event-triggered travel. Travel completes before Event cleanup and returns to the pending Event runtime. Round cleanup expires current-round action and swarm effects, resets per-round flags, preserves effects explicitly scheduled for the next round, advances the round number, and returns to action selection.

Evasion, Gun Jam, Second Wind, and Enter Formation carry an explicit `activeRound` and `expiryRound`. Gun Jam filters legal Attack cards during action selection; Evasion constrains an Attack Action to one Marine; Second Wind changes a raw defense zero into a miss; Enter Formation emits its optional Support decision immediately before each Move + Activate Action.

## Choice and replay policy

All special-text targets, support expenditures, spawn priorities, blip ties, eligible slain cards, and attack targets are engine-issued legal decisions. Full Scan's face-down discard is a hidden-information undo barrier. Temporary Sanctuary's shuffle and all Event draws or die rolls are randomness barriers. Event transitions must preserve pre/post hash continuity across both automatic and player-decision paths.
