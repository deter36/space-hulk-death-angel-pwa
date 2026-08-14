# ADR 0009: Travel, Locations, and victory

Status: Accepted

## Decision

Travel is a canonical state machine shared by both legal triggers: the end of Resolve Actions and the end of the Genestealer Attack phase. It records the phase to resume and resolves in this order: Door slays, one non-rebuilding Location draw, old-Terrain discard, new-Terrain placement, both Blip discards, equal-as-possible refill, Upon Entering effect, and victory check. Engaged swarms remain in formation throughout travel.

Every draw, rebuild shuffle, and die roll uses the centralized deterministic RNG path. Door and Terrain Support return to the common supply at their printed timing. Location Support remains attached to its Location. Terrain positions count from the printed end and clamp to the surviving formation length.

## Location-owned effects

Upon Entering handlers cover Main Corridor, Service Shaft, Lower Accessway, Hibernation Cluster, Munitorium, Wrath of Baal Chapel, Dark Catacombs, Black Holds, Wreckage Labyrinth, and Genestealer Lair. Choice-bearing effects emit legal decisions; automatic effects commit complete transitions.

Control Panel activation dispatches through the current Location for Maintenance Tunnels, Cryo Control, Apothecarion, Teleportarium, Core Cogitator, Genetorium, Launch Control Room, and Toxin Pumping Station. Control Panel dice are canonical randomness barriers and never inherit unrelated combat rerolls.

## Identity and victory

Each Location lists four distinct physical Terrain cards. Travel moves those exact component identities from supply or discard into formation; it does not create logical duplicate Terrain markers.

Generic victory requires a tier-4 Location, no formation swarms, and both Blips empty. Genestealer Lair additionally wins as soon as both Brood Lords are slain. Launch Control may win from its printed Support test. Defeat and all victory paths set terminal status and the `GAME_OVER` phase through committed transitions.
