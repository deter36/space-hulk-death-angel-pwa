# ADR 0006: Move + Activate decision pipeline

Status: Accepted

## Decision

Move + Activate resolves through three ordered optional stages: movement, facing, then Terrain activation. Each accepted player choice is a separate session undo checkpoint.

- Movement offers either a legal Marine-initiated swap or “finish movement.” Standard movement targets adjacent slots; Reorganize targets any other formation slot. Only Marine occupants swap. Facing, Terrain, swarms, and all position-owned state remain unchanged.
- Facing is resolved independently for each surviving team Marine after movement ends.
- Activation is resolved independently for each surviving team Marine after facing ends. A Marine can activate at most one faced Terrain; a Terrain can activate at most once per round. Marines with no legal Terrain advance automatically without a meaningless prompt.

## Card abilities

- Onward Brothers optionally adds a second Support token after a Red Marine activates a Door.
- Reorganize modifies only movement destinations.
- Stealth Tactics discards through the centralized Blip `DRAW_CARD` path and therefore closes player undo at the revealed discard.
- Forward Scouting preserves exact Event identity and top/bottom order; looking at the card is an undo barrier.
- Intimidation uses the canonical die, individual Genestealer selection, tied-smallest-Blip choice, and canonical pile shuffle.
- Run and Gun reuses the standard facing/range target model, Support spending/rerolls, deterministic die records, individual slay choices, and Power Field protection.

Door, Artefact, Spore Chimney, Promethium Tank, and Control Panel Terrain handlers are executable in this pipeline. Promethium Tank uses the shared Marine-death and formation-shift path. Control Panel dispatch is owned by the current Location and returns to the activating team's activation sequence after resolution.

## State and validation

The canonical action runtime records which Marines initiated movement and which have completed facing, activation, and special processing. The runtime must match the current initiative-queue entry. Die state keeps raw value, skull status, modified value, and reroll history separately.
