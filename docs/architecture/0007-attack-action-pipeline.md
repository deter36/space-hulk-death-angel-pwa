# ADR 0007: Attack Action pipeline

Status: Accepted

## Decision

Attack Actions use the shared deterministic combat pipeline defined by execution steps A1-A11. The player chooses each surviving team Marine's order and a legal target for every attack. A legal standard target must be on the Marine's facing side, within printed Range, and not protected from being slain. A Marine may decline an available attack by finishing the Action.

Every combat roll records the raw number, skull flag, modified value, and complete reroll history. Each roll or reroll is a randomness undo barrier. Only the attacking Marine's Support may pay for repeated rerolls, and only while that Marine faces the target. Physical Genestealer identities are selected one at a time when a result can slay multiple cards. A normal Genestealer must be selected before a Brood Lord in the same swarm.

## Card abilities

- Lead By Example offers one optional Support placement after the first Blue kill of the round, subject to supply.
- Flamer Attack ignores skulls for Zael and requires a number of slays equal to the final numeric result, capped by eligible cards in the target swarm.
- Psionic Attack offers Calistarius an immediate additional, independently targeted attack after each final skull result. The player may decline the additional attack.
- Dead Aim treats a final raw 4 as up to three individually selected slays from the defending swarm.
- Full Auto lets Leon make up to three attacks and select a legal target separately each time.
- Heroic Charge replaces Claudio's attack. It selects up to three eligible Genestealers within Range 1 while ignoring facing, then makes a non-attack die roll that cannot spend Support. A raw 0 invokes immediate Marine death and formation shifting.

Power Field protection applies to normal and special attacks. Full Auto and Psionic Attack may change target between attacks in accordance with the official FAQ.

## Marine death

The Attack slice introduces the shared `SLAY_MARINE` and `SHIFT_FORMATION` state operation needed by Heroic Charge. Support returns to supply, the slain card enters its authoritative zone, the rules-selected segment closes the vacancy, and all position-owned Terrain and swarms are reassociated. Eliminated teams lose future Action access. This operation is reusable by hostile attacks, Events, and Terrain effects in later phases.
