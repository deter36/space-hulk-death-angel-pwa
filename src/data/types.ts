export const TEAM_COLORS = ["GREEN", "YELLOW", "BLUE", "RED", "PURPLE", "GREY"] as const;
export type TeamColor = (typeof TEAM_COLORS)[number];

export const SIDES = ["LEFT", "RIGHT"] as const;
export type Side = (typeof SIDES)[number];

export const GENESTEALER_ICONS = ["HEAD", "TAIL", "CLAW", "TONGUE"] as const;
export type GenestealerIcon = (typeof GENESTEALER_ICONS)[number];

export type SourceRef = {
  workbook: "base-game-v2";
  sheet: string;
  row: number;
};

export type PhysicalInstance = {
  id: string;
  definitionId: string;
};

export type ActionDef = {
  id: string;
  team: TeamColor;
  name: string;
  initiative: number;
  type: "SUPPORT" | "MOVE_ACTIVATE" | "ATTACK";
  sourceText: string;
  target: string | null;
  timing: string | null;
  handlerId: string;
  source: SourceRef;
};

export type MarineDef = {
  id: string;
  team: TeamColor;
  name: string;
  attackRange: number;
  namedActionAbility: string | null;
  source: SourceRef;
};

export type EventDef = {
  id: string;
  name: string;
  copyIndex: number | null;
  quantity: number;
  instinct: boolean;
  sourceText: string;
  activations: Array<{ severity: "MAJOR" | "MINOR"; terrainColor: string }>;
  movement: "ADJACENT" | "FLANK" | null;
  movementIcon: GenestealerIcon | null;
  handlerId: string;
  source: SourceRef;
};

export type TerrainDef = {
  id: string;
  name: string;
  spawnColor: string;
  activatable: boolean;
  sourceText: string | null;
  handlerId: string;
  source: SourceRef;
};

export type LocationDef = {
  id: string;
  name: string;
  tier: string;
  leftBlips: number;
  rightBlips: number;
  abilityTiming: string | null;
  sourceText: string | null;
  handlerId: string;
  source: SourceRef;
};

export type SetupLocationDef = {
  id: string;
  name: string;
  playerCounts: number[];
  source: SourceRef;
};
