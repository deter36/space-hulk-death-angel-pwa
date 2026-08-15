import type { LabScenario } from "./formation-types";

export const LAB_SCENARIOS: LabScenario[] = [
  {
    id: "standard",
    name: "Standard formation",
    description: "Six teams, mixed facing, three engagements, and representative Terrain.",
    rows: [
      { left: {}, marine: { name: "Brother Claudio", team: "YELLOW", facing: "LEFT", supportTokens: 1 }, right: {} },
      { left: { terrain: { name: "Door", color: "YELLOW", interaction: "selectable" }, swarm: { icons: ["HEAD", "TAIL"], interaction: "selectable" } }, marine: { name: "Sergeant Lorenzo", team: "BLUE", facing: "LEFT", supportTokens: 2 }, right: {} },
      { left: {}, marine: { name: "Brother Leon", team: "RED", facing: "LEFT", interaction: "unavailable" }, right: {} },
      { left: {}, marine: { name: "Brother Noctis", team: "GREY", facing: "RIGHT", interaction: "targeted", supportTokens: 3 }, right: { terrain: { name: "Ventilation Duct", color: "RED" }, swarm: { icons: ["CLAW", "HEAD", "TAIL"], interaction: "targeted" } } },
      { left: {}, marine: { name: "Brother Zael", team: "PURPLE", facing: "RIGHT" }, right: {} },
      { left: { terrain: { name: "Dark Corner", color: "ORANGE" }, swarm: { icons: ["TONGUE"] } }, marine: { name: "Sergeant Gideon", team: "GREEN", facing: "RIGHT", interaction: "neutral", supportTokens: 1 }, right: {} },
    ],
  },
  {
    id: "crowded",
    name: "Crowded threats",
    description: "Stress test for large swarms, opposing engagements, Brood Lords, and adjacent Terrain.",
    rows: [
      { left: { terrain: { name: "Door", color: "YELLOW" }, swarm: { icons: ["HEAD", "TAIL", "CLAW", "TONGUE"] } }, marine: { name: "Brother Claudio", team: "YELLOW", facing: "LEFT" }, right: { swarm: { icons: ["HEAD", "HEAD"] } } },
      { left: { swarm: { icons: ["TAIL", "TAIL", "CLAW"], broodLords: 1 } }, marine: { name: "Sergeant Lorenzo", team: "BLUE", facing: "RIGHT" }, right: { terrain: { name: "Control Panel", color: "YELLOW" } } },
      { left: { terrain: { name: "Dark Corner", color: "ORANGE" } }, marine: { name: "Brother Leon", team: "RED", facing: "LEFT" }, right: { terrain: { name: "Ventilation Duct", color: "GREEN" }, swarm: { icons: ["TONGUE", "CLAW", "HEAD", "TAIL", "HEAD"] } } },
      { left: { swarm: { icons: ["CLAW"] } }, marine: { name: "Brother Noctis", team: "GREY", facing: "RIGHT" }, right: { swarm: { icons: ["TAIL", "TONGUE", "HEAD"] } } },
      { left: { terrain: { name: "Promethium Tank", color: "ORANGE" }, swarm: { icons: ["HEAD", "CLAW"] } }, marine: { name: "Brother Zael", team: "PURPLE", facing: "LEFT" }, right: {} },
      { left: {}, marine: { name: "Sergeant Gideon", team: "GREEN", facing: "RIGHT" }, right: { terrain: { name: "Spore Chimney", color: "RED" }, swarm: { icons: ["TONGUE", "TONGUE"], broodLords: 2 } } },
    ],
  },
  {
    id: "open",
    name: "Open formation",
    description: "Mostly empty flanks for evaluating row rhythm, alignment, and clear destination space.",
    rows: [
      { left: {}, marine: { name: "Brother Claudio", team: "YELLOW", facing: "LEFT" }, right: {} },
      { left: {}, marine: { name: "Sergeant Lorenzo", team: "BLUE", facing: "LEFT" }, right: {} },
      { left: {}, marine: { name: "Brother Leon", team: "RED", facing: "LEFT" }, right: { terrain: { name: "Corridor", color: "GREEN" } } },
      { left: {}, marine: { name: "Brother Noctis", team: "GREY", facing: "RIGHT" }, right: {} },
      { left: { terrain: { name: "Door", color: "YELLOW" } }, marine: { name: "Brother Zael", team: "PURPLE", facing: "RIGHT" }, right: {} },
      { left: {}, marine: { name: "Sergeant Gideon", team: "GREEN", facing: "RIGHT" }, right: {} },
    ],
  },
];

export const INTERACTION_SCENARIO: LabScenario = {
  id: "solo-interactions",
  name: "Solo interaction formation",
  description: "Three complete combat teams for testing board-driven Move + Activate, Attack, Strategize, and inspection flows.",
  rows: [
    { left: {}, marine: { name: "Sergeant Gideon", team: "GREEN", facing: "LEFT", supportTokens: 1 }, right: { swarm: { icons: ["HEAD"] } } },
    { left: { terrain: { name: "Door", color: "YELLOW" }, swarm: { icons: ["TAIL", "CLAW"] } }, marine: { name: "Brother Noctis", team: "GREEN", facing: "LEFT" }, right: {} },
    { left: {}, marine: { name: "Sergeant Lorenzo", team: "BLUE", facing: "RIGHT", supportTokens: 2 }, right: { terrain: { name: "Control Panel", color: "YELLOW" }, swarm: { icons: ["HEAD", "TONGUE", "CLAW"] } } },
    { left: { swarm: { icons: ["TAIL"], broodLords: 1 } }, marine: { name: "Brother Deino", team: "BLUE", facing: "LEFT" }, right: { terrain: { name: "Ventilation Duct", color: "RED" } } },
    { left: { terrain: { name: "Promethium Tank", color: "ORANGE" } }, marine: { name: "Brother Leon", team: "RED", facing: "RIGHT", supportTokens: 1 }, right: { swarm: { icons: ["HEAD", "TAIL"] } } },
    { left: { swarm: { icons: ["TONGUE", "CLAW"] } }, marine: { name: "Brother Valencio", team: "RED", facing: "RIGHT" }, right: { terrain: { name: "Spore Chimney", color: "RED" } } },
  ],
};
