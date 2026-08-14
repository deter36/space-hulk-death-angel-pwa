import dataJson from "@/src/data/generated/base-game.json";
import type { TeamColor } from "@/src/data/types";

export type ActionDefinition = {
  id: string;
  team: TeamColor;
  name: string;
  initiative: number;
  type: "SUPPORT" | "MOVE_ACTIVATE" | "ATTACK";
  sourceText: string;
  target: string | null;
  timing: string | null;
  handlerId: string;
};

type MarineDefinition = { id: string; team: TeamColor; name: string; attackRange: number };
export type BroodLordDefinition = { id: string; name: string; movementIcons: Array<"HEAD" | "TAIL" | "CLAW" | "TONGUE"> };
export type TerrainDefinition = { id: string; name: string; spawnColor: string; activatable: boolean; handlerId: string; sourceText: string };
export type EventDefinition = {
  id: string;
  name: string;
  copyIndex: number | null;
  instinct: boolean;
  sourceText: string;
  activations: Array<{ severity: "MAJOR" | "MINOR"; terrainColor: string }>;
  movement: "ADJACENT" | "FLANK" | null;
  movementIcon: "HEAD" | "TAIL" | "CLAW" | "TONGUE" | null;
  handlerId: string;
};
export type LocationDefinition = { id: string; name: string; tier: string; leftBlips: number; rightBlips: number; abilityTiming: string | null; sourceText: string | null; handlerId: string };
export type LocationTerrainDefinition = { locationId: string; side: "LEFT" | "RIGHT"; markerOrder: number; terrainId: string; distance: number; countFrom: "TOP" | "BOTTOM" };

const data = dataJson as unknown as {
  definitions: { actions: ActionDefinition[]; marines: MarineDefinition[]; broodLords: BroodLordDefinition[]; terrain: TerrainDefinition[]; events: EventDefinition[]; locations: LocationDefinition[]; locationTerrain: LocationTerrainDefinition[] };
  setup: { playerSetups: Array<{ players: number; majorSpawn: number; minorSpawn: number }> };
};

export const ACTIONS = data.definitions.actions;
export const MARINES = data.definitions.marines;
export const BROOD_LORDS = data.definitions.broodLords;
export const TERRAIN = data.definitions.terrain;
export const EVENTS = data.definitions.events;
export const LOCATIONS = data.definitions.locations;
export const LOCATION_TERRAIN = data.definitions.locationTerrain;
export const SOLO_SETUP = data.setup.playerSetups.find((setup) => setup.players === 1)!;

export function actionDefinition(actionInstanceId: string): ActionDefinition {
  const definition = ACTIONS.find((action) => action.id === actionInstanceId);
  if (!definition) throw new Error(`Unknown Action card: ${actionInstanceId}`);
  return definition;
}

export function terrainDefinition(terrainInstanceId: string): TerrainDefinition {
  const definitionId = terrainInstanceId.split("#", 1)[0];
  const definition = TERRAIN.find((terrain) => terrain.id === definitionId);
  if (!definition) throw new Error(`Unknown Terrain card: ${terrainInstanceId}`);
  return definition;
}

export function locationDefinition(locationInstanceId: string): LocationDefinition {
  const definition = LOCATIONS.find((location) => location.id === locationInstanceId);
  if (!definition) throw new Error(`Unknown Location card: ${locationInstanceId}`);
  return definition;
}

export function eventDefinition(eventInstanceId: string): EventDefinition {
  const definitionId = eventInstanceId.startsWith("event.") && eventInstanceId.match(/\.\d{2}$/)
    ? eventInstanceId.replace(/\.\d{2}$/, "")
    : eventInstanceId;
  const definition = EVENTS.find((event) => event.id === definitionId);
  if (!definition) throw new Error(`Unknown Event card: ${eventInstanceId}`);
  return definition;
}

export function actionTeam(actionInstanceId: string): TeamColor {
  return actionDefinition(actionInstanceId).team;
}
