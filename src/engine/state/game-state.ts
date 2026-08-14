import type { GenestealerIcon, Side, TeamColor } from "@/src/data/types";
import type { ZonedInstance } from "./zones";

export type Phase = "SETUP" | "CHOOSE_ACTIONS" | "RESOLVE_ACTIONS" | "GENESTEALER_ATTACK" | "EVENT" | "GAME_OVER";

export type RngState = {
  algorithm: "SHA256_COUNTER_V1";
  seedHex: string;
  nextCounter: string;
  currentDigestHex: string | null;
  byteOffset: number;
  operationSeq: number;
};

export type EffectState = {
  id: string;
  sourceId: string;
  startTiming: string;
  expiryTiming: string;
  targetIds: string[];
  mergePropagation: "NONE" | "CONSTITUENT" | "WHOLE_MERGED_SWARM";
  data: Record<string, string | number | boolean | null>;
};

export type MarineState = {
  instanceId: string;
  facing: Side;
  support: number;
  effects: EffectState[];
};

export type TerrainState = {
  instanceId: string;
  positionIndex: number;
  side: Side;
  support: number;
  activatedThisRound: boolean;
  state: Record<string, string | number | boolean | null>;
};

export type GenestealerState = {
  instanceId: string;
  icon: GenestealerIcon;
  movedOrFlankedThisEvent: boolean;
  effects: EffectState[];
};

export type SwarmState = {
  id: string;
  positionIndex: number;
  side: Side;
  cardIds: string[];
  broodLordIds: string[];
  attackedThisAttackPhase: boolean;
  effects: EffectState[];
};

export type CombatTeamState = {
  color: TeamColor;
  active: boolean;
  marineInstanceIds: string[];
  actionInstanceIds: string[];
  chosenActionInstanceId: string | null;
  previousActionInstanceId: string | null;
};

export type DieRuntimeRecord = {
  id: string;
  sourceId: string;
  purpose: string;
  rawValue: 0 | 1 | 2 | 3 | 4 | 5;
  skull: boolean;
  modifiedValue: number;
  rerolls: Array<{ rawValue: 0 | 1 | 2 | 3 | 4 | 5; skull: boolean; modifiedValue: number }>;
};

export type ActionRuntimeState = {
  actionId: string;
  movedMarineIds: string[];
  facingResolvedMarineIds: string[];
  activationResolvedMarineIds: string[];
  specialResolvedMarineIds: string[];
  selectedCardIds: string[];
  data: Record<string, string | number | boolean | null>;
};

export type GenestealerAttackRuntimeState = {
  swarmId: string;
  defenderMarineId: string;
  repeatAttack: boolean;
  rerolledWithSupport: boolean;
};

export type TravelRuntimeState = {
  returnPhase: Phase;
  doorRemaining: number;
  arrivalRemaining: number;
  activatingMarineId: string | null;
  data: Record<string, string | number | boolean | null>;
};

export type EventRuntimeState = {
  eventCardId: string | null;
  activationIndex: number;
  spawnTerrainIds: string[];
  movementQueue: string[];
  selectedCardIds: string[];
  processedMarineIds: string[];
  movedCardIds: string[];
  data: Record<string, string | number | boolean | null>;
};

export type FormationSlot = {
  marineInstanceId: string;
  terrainInstanceIds: Record<Side, string[]>;
  swarmIds: Record<Side, string[]>;
};

export type DecisionOption = {
  id: string;
  label: string;
  payload: Record<string, string | number | boolean | null>;
  canonicalEffectPreview: string | null;
};

export type PendingDecision = {
  id: string;
  type: string;
  sourceId: string;
  promptKey: string;
  legalOptions: DecisionOption[];
  context: Record<string, string | number | boolean | null>;
  createdAtTransition: number;
};

export type PendingCheckpoint = {
  id: string;
  sourceId: string;
  timing: string;
  kind: "TRIGGER" | "CHECK" | "DECISION";
  mandatory: boolean;
  affectedIds: string[];
  decisionId: string | null;
};

export type GameState = {
  schemaVersion: "1.0.0";
  canonicalFormatVersion: "1";
  engineVersion: string;
  dataVersion: string;
  gameId: string;
  round: number;
  phase: Phase;
  status: "IN_PROGRESS" | "VICTORY" | "DEFEAT";
  activeTeams: TeamColor[];
  teams: Record<TeamColor, CombatTeamState>;
  actionQueue: string[];
  currentActionIndex: number;
  actionStep: string | null;
  actionRuntime: ActionRuntimeState | null;
  activeDie: DieRuntimeRecord | null;
  genestealerAttackQueue: string[];
  currentGenestealerAttackIndex: number;
  genestealerAttackStep: string | null;
  genestealerAttackRuntime: GenestealerAttackRuntimeState | null;
  travelStep: string | null;
  travelRuntime: TravelRuntimeState | null;
  eventStep: string | null;
  eventRuntime: EventRuntimeState | null;
  currentPlayerTeam: TeamColor | null;
  setupLocationInstanceId: string;
  currentLocationInstanceId: string;
  components: Record<string, ZonedInstance>;
  orderedSources: Record<string, string[]>;
  formation: FormationSlot[];
  marines: Record<string, MarineState>;
  terrain: Record<string, TerrainState>;
  genestealers: Record<string, GenestealerState>;
  swarms: Record<string, SwarmState>;
  supportSupply: number;
  locationSupport: Record<string, number>;
  pendingQueue: PendingCheckpoint[];
  pendingDecision: PendingDecision | null;
  roundEffects: EffectState[];
  rng: RngState;
  transitionSeq: number;
};
