import dataJson from "@/src/data/generated/base-game.json";
import { TEAM_COLORS, type GenestealerIcon, type Side, type TeamColor } from "@/src/data/types";
import { drawCard, DrawUnavailableError } from "../cards/draw-card";
import { Sha256CounterRng } from "../rng/sha256-counter";
import type { GameState, SwarmState, TerrainState } from "../state/game-state";
import type { ComponentZone, ZonedInstance } from "../state/zones";
import { commitTransition } from "../transitions/commit";
import type { EngineResult, RandomRecord, TransitionRecord } from "../transitions/types";
import { assertStateInvariants } from "../validation/invariants";

type Instance = { id: string; definitionId: string };
type Database = {
  dataVersion: string;
  definitions: {
    actions: Array<{ id: string; team: TeamColor }>;
    marines: Array<{ id: string; team: TeamColor }>;
    events: Array<{ id: string; activations: Array<{ severity: "MAJOR" | "MINOR"; terrainColor: string }> }>;
    terrain: Array<{ id: string; spawnColor: string }>;
    locations: Array<{ id: string; tier: string }>;
    genestealerTypes: Array<{ id: string; icon: GenestealerIcon }>;
  };
  setup: {
    playerSetups: Array<{
      players: number;
      formationSize: number;
      locationDeckSetup: string[];
      majorSpawn: number;
      minorSpawn: number;
      startLeftBlips: number;
      startRightBlips: number;
      setupLocationId: string;
    }>;
    setupTerrain: Array<{
      setup: string;
      side: Side;
      terrainId: string;
      distance: number;
      countFrom: "TOP" | "BOTTOM";
      markerOrder: number;
    }>;
  };
  instances: {
    actions: Instance[];
    marines: Instance[];
    events: Instance[];
    terrain: Instance[];
    locations: Instance[];
    setupLocations: Instance[];
    genestealers: Instance[];
    broodLords: Instance[];
  };
};

const data = dataJson as unknown as Database;
const ENGINE_VERSION = "0.11.0";

export type NewGameConfig = {
  gameId: string;
  seed: string;
  teamColors: readonly [TeamColor, TeamColor, TeamColor];
};

function component(instance: Instance, kind: ZonedInstance["kind"], zone: ComponentZone, containerId: string | null): ZonedInstance {
  return { instanceId: instance.id, definitionId: instance.definitionId, kind, zone, containerId };
}

function initialState(config: NewGameConfig, activeTeams: TeamColor[], rng: Sha256CounterRng): GameState {
  const setup = data.setup.playerSetups.find((item) => item.players === 1);
  if (!setup) throw new Error("Solo setup data is missing");
  const setupLocation = data.instances.setupLocations.find((item) => item.definitionId === setup.setupLocationId);
  if (!setupLocation) throw new Error("Solo Setup Location instance is missing");

  const components: Record<string, ZonedInstance> = {};
  const addAll = (instances: Instance[], kind: ZonedInstance["kind"], zone: ComponentZone, containerId: string | null) => {
    for (const instance of instances) components[instance.id] = component(instance, kind, zone, containerId);
  };
  addAll(data.instances.actions, "ACTION", "REMOVED", null);
  addAll(data.instances.marines, "MARINE", "UNUSED", null);
  addAll(data.instances.events, "EVENT", "DECK", "event.deck");
  addAll(data.instances.terrain, "TERRAIN", "SUPPLY", null);
  addAll(data.instances.locations, "LOCATION", "UNUSED", null);
  addAll(data.instances.setupLocations, "SETUP_LOCATION", "UNUSED", null);
  addAll(data.instances.genestealers, "GENESTEALER", "DECK", "genestealer.deck");
  addAll(data.instances.broodLords, "BROOD_LORD", "RESERVE", null);
  components[setupLocation.id].zone = "CURRENT";

  const teams = Object.fromEntries(TEAM_COLORS.map((color) => {
    const marineInstanceIds = data.instances.marines.filter((instance) => {
      const definition = data.definitions.marines.find((item) => item.id === instance.definitionId);
      return definition?.team === color;
    }).map((instance) => instance.id);
    const actionInstanceIds = data.instances.actions.filter((instance) => {
      const definition = data.definitions.actions.find((item) => item.id === instance.definitionId);
      return definition?.team === color;
    }).map((instance) => instance.id);
    const active = activeTeams.includes(color);
    for (const actionId of actionInstanceIds) {
      components[actionId].zone = active ? "TEAM_HAND" : "REMOVED";
      components[actionId].containerId = active ? `team.${color.toLowerCase()}` : null;
    }
    return [color, { color, active, marineInstanceIds, actionInstanceIds, chosenActionInstanceId: null, previousActionInstanceId: null }];
  })) as GameState["teams"];

  const genestealerTypeById = Object.fromEntries(data.definitions.genestealerTypes.map((definition) => [definition.id, definition]));
  return {
    schemaVersion: "1.0.0",
    canonicalFormatVersion: "1",
    engineVersion: ENGINE_VERSION,
    dataVersion: data.dataVersion,
    gameId: config.gameId,
    round: 0,
    phase: "SETUP",
    status: "IN_PROGRESS",
    activeTeams,
    teams,
    actionQueue: [],
    currentActionIndex: 0,
    actionStep: null,
    actionRuntime: null,
    activeDie: null,
    genestealerAttackQueue: [],
    currentGenestealerAttackIndex: 0,
    genestealerAttackStep: null,
    genestealerAttackRuntime: null,
    travelStep: null,
    travelRuntime: null,
    eventStep: null,
    eventRuntime: null,
    currentPlayerTeam: null,
    setupLocationInstanceId: setupLocation.id,
    currentLocationInstanceId: setupLocation.id,
    components,
    orderedSources: {
      "event.deck": data.instances.events.map((item) => item.id),
      "event.discard": [],
      "genestealer.deck": data.instances.genestealers.map((item) => item.id),
      "genestealer.discard": [],
      "brood-lord.discard": [],
      "location.deck": [],
      "blip.left": [],
      "blip.right": [],
    },
    formation: [],
    marines: {},
    terrain: {},
    genestealers: Object.fromEntries(data.instances.genestealers.map((instance) => [instance.id, {
      instanceId: instance.id,
      icon: genestealerTypeById[instance.definitionId].icon,
      movedOrFlankedThisEvent: false,
      effects: [],
    }])),
    swarms: {},
    supportSupply: 12,
    locationSupport: {},
    pendingQueue: [],
    pendingDecision: null,
    roundEffects: [],
    rng: rng.snapshot(),
    transitionSeq: 0,
  };
}

function shuffleSource(state: GameState, rng: Sha256CounterRng, sourceId: string): TransitionRecord {
  const before = state.orderedSources[sourceId];
  const shuffled = rng.shuffle(before);
  const resultingRng = rng.snapshot();
  const randomInput: RandomRecord = { operationSeq: resultingRng.operationSeq, kind: "SHUFFLE", sourceId, cardId: null, preLength: before.length, postLength: shuffled.length, resultingRng };
  return commitTransition(state, "PILE_SHUFFLED", sourceId, () => {
    state.orderedSources[sourceId] = shuffled;
    state.rng = resultingRng;
  }, { randomInputs: [randomInput] });
}

function buildLocationDeck(state: GameState, rng: Sha256CounterRng, transitions: TransitionRecord[]): void {
  const setup = data.setup.playerSetups.find((item) => item.players === 1)!;
  for (const tier of setup.locationDeckSetup) {
    const candidates = data.instances.locations.filter((instance) => data.definitions.locations.find((location) => location.id === instance.definitionId)?.tier === tier).map((item) => item.id);
    const shuffled = rng.shuffle(candidates);
    const selected = shuffled[0];
    const resultingRng = rng.snapshot();
    transitions.push(commitTransition(state, "LOCATION_TIER_SHUFFLED", `location.tier.${tier}`, () => {
      state.orderedSources["location.deck"].push(selected);
      state.components[selected].zone = "DECK";
      state.components[selected].containerId = "location.deck";
      state.rng = resultingRng;
    }, {
      randomInputs: [{ operationSeq: resultingRng.operationSeq, kind: "SHUFFLE", sourceId: `location.tier.${tier}`, cardId: selected, preLength: candidates.length, postLength: shuffled.length, resultingRng }],
    }));
  }
}

function buildFormation(state: GameState, rng: Sha256CounterRng): TransitionRecord {
  const selected = state.activeTeams.flatMap((color) => state.teams[color].marineInstanceIds);
  const shuffled = rng.shuffle(selected);
  const resultingRng = rng.snapshot();
  return commitTransition(state, "FORMATION_CREATED", "setup", () => {
    state.formation = shuffled.map((marineInstanceId, index) => {
      const facing: Side = index < shuffled.length / 2 ? "LEFT" : "RIGHT";
      state.components[marineInstanceId].zone = "FORMATION";
      state.components[marineInstanceId].containerId = `formation.${index}`;
      state.marines[marineInstanceId] = { instanceId: marineInstanceId, facing, support: 0, effects: [] };
      return { marineInstanceId, terrainInstanceIds: { LEFT: [], RIGHT: [] }, swarmIds: { LEFT: [], RIGHT: [] } };
    });
    state.rng = resultingRng;
  }, {
    randomInputs: [{ operationSeq: resultingRng.operationSeq, kind: "SHUFFLE", sourceId: "formation", cardId: null, preLength: selected.length, postLength: shuffled.length, resultingRng }],
  });
}

function placeTerrain(state: GameState): TransitionRecord {
  const placements = data.setup.setupTerrain.filter((item) => item.setup === "Void Lock - 1 player");
  return commitTransition(state, "TERRAIN_PLACED", state.setupLocationInstanceId, () => {
    for (const placement of placements) {
      const positionIndex = placement.countFrom === "TOP"
        ? Math.min(placement.distance - 1, state.formation.length - 1)
        : Math.max(state.formation.length - placement.distance, 0);
      const instance = data.instances.terrain.find((item) => item.definitionId === placement.terrainId)!;
      const terrain: TerrainState = { instanceId: instance.id, positionIndex, side: placement.side, support: 0, activatedThisRound: false, state: {} };
      state.terrain[instance.id] = terrain;
      state.formation[positionIndex].terrainInstanceIds[placement.side].push(instance.id);
      state.components[instance.id].zone = "FORMATION";
      state.components[instance.id].containerId = `formation.${positionIndex}.${placement.side.toLowerCase()}`;
    }
  });
}

function fillBlip(state: GameState, rng: Sha256CounterRng, side: Side, count: number, transitions: TransitionRecord[]): void {
  const sourceId = side === "LEFT" ? "blip.left" : "blip.right";
  for (let index = 0; index < count; index += 1) {
    const result = drawCard(state, rng, "genestealer.deck", { zone: side === "LEFT" ? "LEFT_BLIP" : "RIGHT_BLIP", containerId: sourceId }, (cardId) => {
      state.orderedSources[sourceId].push(cardId);
    });
    transitions.push(...result.transitions);
  }
}

function spawnStartingGenestealers(state: GameState, rng: Sha256CounterRng, eventCardId: string, transitions: TransitionRecord[]): void {
  const eventDefinitionId = state.components[eventCardId].definitionId;
  const event = data.definitions.events.find((item) => item.id === eventDefinitionId)!;
  const setup = data.setup.playerSetups.find((item) => item.players === 1)!;
  const terrainDefByInstance = Object.fromEntries(data.instances.terrain.map((instance) => [instance.id, data.definitions.terrain.find((item) => item.id === instance.definitionId)!]));

  for (const activation of event.activations) {
    const quantity = activation.severity === "MAJOR" ? setup.majorSpawn : setup.minorSpawn;
    const matchingTerrain = Object.values(state.terrain)
      .filter((terrain) => terrainDefByInstance[terrain.instanceId].spawnColor === activation.terrainColor)
      .sort((left, right) => left.positionIndex - right.positionIndex || (left.side === "LEFT" ? -1 : 1));
    for (const terrain of matchingTerrain) {
      for (let index = 0; index < quantity; index += 1) {
        const sourceId = terrain.side === "LEFT" ? "blip.left" : "blip.right";
        if (state.orderedSources[sourceId].length === 0) break;
        const existing = state.formation[terrain.positionIndex].swarmIds[terrain.side]
          .map((id) => state.swarms[id])
          .find(Boolean);
        const swarmId = existing?.id ?? `swarm.${String(Object.keys(state.swarms).length + 1).padStart(4, "0")}`;
        try {
          const result = drawCard(state, rng, sourceId, { zone: "SWARM", containerId: swarmId }, (cardId) => {
            let swarm: SwarmState | undefined = state.swarms[swarmId];
            if (!swarm) {
              swarm = { id: swarmId, positionIndex: terrain.positionIndex, side: terrain.side, cardIds: [], broodLordIds: [], attackedThisAttackPhase: false, effects: [] };
              state.swarms[swarmId] = swarm;
              state.formation[terrain.positionIndex].swarmIds[terrain.side].push(swarmId);
            }
            swarm.cardIds.push(cardId);
          });
          transitions.push(...result.transitions);
        } catch (error) {
          if (error instanceof DrawUnavailableError) break;
          throw error;
        }
      }
    }
  }
}

export function createNewGame(config: NewGameConfig): EngineResult {
  if (!config.gameId.trim()) throw new TypeError("gameId is required");
  if (!config.seed.length) throw new TypeError("seed is required");
  if (config.teamColors.length !== 3 || new Set(config.teamColors).size !== 3 || config.teamColors.some((color) => !TEAM_COLORS.includes(color))) {
    throw new TypeError("Solo setup requires three unique valid Combat Teams");
  }
  const activeTeams = TEAM_COLORS.filter((color) => config.teamColors.includes(color));
  const rng = new Sha256CounterRng(config.seed);
  const state = initialState(config, activeTeams, rng);
  const transitions: TransitionRecord[] = [];
  transitions.push(commitTransition(state, "GAME_CREATED", null, () => {}));
  transitions.push(shuffleSource(state, rng, "genestealer.deck"));
  transitions.push(shuffleSource(state, rng, "event.deck"));
  buildLocationDeck(state, rng, transitions);
  transitions.push(buildFormation(state, rng));
  transitions.push(placeTerrain(state));
  const setup = data.setup.playerSetups.find((item) => item.players === 1)!;
  fillBlip(state, rng, "LEFT", setup.startLeftBlips, transitions);
  fillBlip(state, rng, "RIGHT", setup.startRightBlips, transitions);

  const eventDraw = drawCard(state, rng, "event.deck", { zone: "RESOLVING", containerId: null });
  transitions.push(...eventDraw.transitions);
  spawnStartingGenestealers(state, rng, eventDraw.cardId, transitions);
  transitions.push(commitTransition(state, "SETUP_EVENT_DISCARDED", eventDraw.cardId, () => {
    state.components[eventDraw.cardId].zone = "DISCARD";
    state.components[eventDraw.cardId].containerId = "event.discard";
    state.orderedSources["event.discard"].push(eventDraw.cardId);
  }));
  transitions.push(commitTransition(state, "SETUP_COMPLETED", state.setupLocationInstanceId, () => {
    state.round = 1;
    state.phase = "CHOOSE_ACTIONS";
  }));
  assertStateInvariants(state);
  return { state, transitions, pendingDecision: null };
}
