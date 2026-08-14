export type ActionZone = "TEAM_HAND" | "SELECTED" | "RESOLVING" | "REMOVED";
export type EventZone = "DECK" | "RESOLVING" | "DISCARD";
export type LocationZone = "UNUSED" | "DECK" | "CURRENT" | "SETUP_REFERENCE" | "PREVIOUS";
export type MarineZone = "UNUSED" | "FORMATION" | "SLAIN";
export type TerrainZone = "SUPPLY" | "FORMATION" | "PLAYER_POSSESSION" | "DISCARD";
export type GenestealerZone = "DECK" | "LEFT_BLIP" | "RIGHT_BLIP" | "SWARM" | "DISCARD";
export type BroodLordZone = "RESERVE" | "LEFT_BLIP" | "RIGHT_BLIP" | "SWARM" | "DISCARD";

export type ComponentZone =
  | ActionZone
  | EventZone
  | LocationZone
  | MarineZone
  | TerrainZone
  | GenestealerZone
  | BroodLordZone;

export type ZonedInstance = {
  instanceId: string;
  definitionId: string;
  kind: "ACTION" | "EVENT" | "LOCATION" | "SETUP_LOCATION" | "MARINE" | "TERRAIN" | "GENESTEALER" | "BROOD_LORD";
  zone: ComponentZone;
  containerId: string | null;
};
