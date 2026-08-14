# ADR 0002: Physical identities and authoritative zones

Status: Accepted

## Decision

Definitions and physical instances are distinct. A definition describes shared printed data; every physical card receives a stable instance ID.

Every instance occupies exactly one authoritative zone:

- Action: team hand, selected, resolving, or removed.
- Event: deck, resolving, or discard.
- Mission Location: unused, deck, current, or previous/discarded.
- Setup Location: unused, current during setup, then retained as the setup reference.
- Marine: unused reserve, formation, or slain.
- Terrain: supply, formation, player possession, or discard. This includes the held Artefact and self-discarding Terrain.
- Normal Genestealer: deck, left/right blip, logical swarm, or discard.
- Brood Lord: reserve, logical swarm, or discard.
- Support token: common supply or attached to a Marine, Terrain card, or Location card.

Definitions use stable gameplay IDs. Mechanically identical copies share a definition and receive numbered instance IDs. Same-title cards with different printed gameplay data receive distinct variant definitions, such as `event.out-of-thin-air.copy-1` and `event.out-of-thin-air.copy-2`, while both retain the printed display name “Out of Thin Air.”

Logical swarms are runtime containers rather than physical components. Multiple logical swarms may temporarily share a formation position and side when attack bookkeeping requires it.

## Invariants

- Each physical instance appears in exactly one zone.
- Definition quantity equals the number of generated instances.
- Displayed counts are derived from authoritative collections.
- Voluntary Marine movement swaps Marine occupants only.
- Death shifting moves all entities in the selected formation segment.

Indistinguishable Support tokens are represented as conserved quantities rather than individual IDs. Their authoritative locations are the common supply and the Support fields on Marine, Terrain, and Location runtime state.
