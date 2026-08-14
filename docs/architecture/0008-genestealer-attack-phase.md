# ADR 0008: Genestealer Attack phase

Status: Accepted

## Decision

The hostile attack phase builds one canonical queue at phase start: top formation position first, with the left swarm before the right swarm at a shared position. Queue entries are stable swarm identities, so death-induced formation shifts never grant an already processed swarm another attack. Separate swarms that collide during a shift remain logically separate until their later merge timing.

Every eligible swarm rolls the combat die, even when its size makes an ordinary save impossible. The defense die record preserves the raw number and skull flag while applying one cumulative minus-one modifier per Brood Lord only to the modified numeric value. The final ordinary result is a miss only when the modified value is greater than swarm size.

A Power Field swarm is marked processed without rolling because it cannot attack. Other prevention and trigger effects resolve before ordinary Support rerolls.

## Defensive abilities and rerolls

- Block makes a raw defensive skull rolled by Sergeant Gideon miss, including attacks from behind.
- Defensive Stance makes a Yellow Marine's Support-funded reroll miss unless its new raw value is zero. A zero may be rerolled again if another Support token is legally available.
- Counter Attack makes Sergeant Lorenzo's raw skull miss, slays one eligible attacker, and immediately repeats the same swarm's attack if it remains. The ability works from behind, while slay choices still respect Power Field and Brood Lord restrictions.
- Overwatch remains registered but does not resolve during this phase; its printed timing is the end of the Event phase.

Only the defending Marine's Support may reroll a defense die, and only when the Marine faces the swarm. Every initial roll and reroll is a randomness undo barrier.

## Death, shifting, and phase exit

Marine death immediately returns Support, removes the Marine, shifts the rules-selected formation segment, reassociates all position-owned Terrain and swarms, updates team elimination, and transfers current-player identity when required. Temporary effects created by an eliminated team remain until their own expiry timing.

At phase end, an empty blip pile with a nonempty Location deck enters the Location subsystem's travel state machine. Travel returns to the Event phase after its Door, Location, Terrain, Blip, arrival, and victory steps complete. Otherwise the engine enters the Event phase directly.
