import type { GenestealerIcon, Side, TeamColor } from "@/src/data/types";

export type LabTerrain = {
  color: "GREEN" | "YELLOW" | "ORANGE" | "RED";
  interaction?: "selectable" | "selected" | "targeted";
  name: string;
};

export type LabSwarm = {
  broodLords?: number;
  icons: GenestealerIcon[];
  interaction?: "selectable" | "selected" | "targeted";
};

export type LabFlank = {
  swarm?: LabSwarm;
  terrain?: LabTerrain;
};

export type LabMarine = {
  ability?: string;
  abilityText?: string;
  facing: Side;
  interaction?: "neutral" | "selectable" | "unavailable" | "targeted";
  name: string;
  range?: number;
  supportTokens?: number;
  team: TeamColor;
};

export type LabFormationRow = {
  left: LabFlank;
  marine: LabMarine;
  right: LabFlank;
};

export type LabScenario = {
  description: string;
  id: string;
  name: string;
  rows: LabFormationRow[];
};
