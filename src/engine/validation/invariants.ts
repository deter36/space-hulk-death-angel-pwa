import { TEAM_COLORS } from "@/src/data/types";
import type { GameState } from "../state/game-state";

export type InvariantIssue = { code: string; message: string };

export function validateState(state: GameState): InvariantIssue[] {
  const issues: InvariantIssue[] = [];
  const add = (code: string, message: string) => issues.push({ code, message });
  const orderedMembership = new Map<string, string>();

  for (const [sourceId, cards] of Object.entries(state.orderedSources)) {
    for (const cardId of cards) {
      if (orderedMembership.has(cardId)) add("CARD_DUPLICATE", `${cardId} appears in ${orderedMembership.get(cardId)} and ${sourceId}`);
      orderedMembership.set(cardId, sourceId);
      const component = state.components[cardId];
      if (!component) add("CARD_UNKNOWN", `${sourceId} contains unknown component ${cardId}`);
      else if (component.containerId !== sourceId) add("CONTAINER_MISMATCH", `${cardId} does not point to ${sourceId}`);
    }
  }

  for (const [id, component] of Object.entries(state.components)) {
    if (component.instanceId !== id) add("IDENTITY_MISMATCH", `Component key ${id} does not match its instance ID`);
    if (component.containerId && state.orderedSources[component.containerId] && orderedMembership.get(id) !== component.containerId) {
      add("ORDERED_MEMBERSHIP", `${id} is not present in its ordered source ${component.containerId}`);
    }
  }

  const formationMarineIds = state.formation.map((slot) => slot.marineInstanceId);
  if (new Set(formationMarineIds).size !== formationMarineIds.length) add("FORMATION_DUPLICATE", "A Marine occupies multiple formation slots");
  for (const marineId of formationMarineIds) {
    if (state.components[marineId]?.zone !== "FORMATION" || !state.marines[marineId]) add("FORMATION_MARINE", `${marineId} is not a live formation Marine`);
  }
  for (const marineId of Object.keys(state.marines)) {
    if (!formationMarineIds.includes(marineId)) add("MARINE_ORPHAN", `${marineId} has runtime state but no formation slot`);
  }

  const terrainIds = new Set<string>();
  const swarmIds = new Set<string>();
  state.formation.forEach((slot, positionIndex) => {
    for (const side of ["LEFT", "RIGHT"] as const) {
      for (const terrainId of slot.terrainInstanceIds[side]) {
        terrainIds.add(terrainId);
        const terrain = state.terrain[terrainId];
        if (!terrain || terrain.positionIndex !== positionIndex || terrain.side !== side) add("TERRAIN_POSITION", `${terrainId} has inconsistent placement`);
        if (state.components[terrainId]?.zone !== "FORMATION") add("TERRAIN_ZONE", `${terrainId} is placed but not in the FORMATION zone`);
      }
      for (const swarmId of slot.swarmIds[side]) {
        swarmIds.add(swarmId);
        const swarm = state.swarms[swarmId];
        if (!swarm || swarm.positionIndex !== positionIndex || swarm.side !== side) add("SWARM_POSITION", `${swarmId} has inconsistent placement`);
      }
    }
  });
  for (const id of Object.keys(state.terrain)) if (!terrainIds.has(id)) add("TERRAIN_ORPHAN", `${id} has runtime state but no formation placement`);
  for (const id of Object.keys(state.swarms)) if (!swarmIds.has(id)) add("SWARM_ORPHAN", `${id} has runtime state but no formation placement`);

  const swarmCards = new Set<string>();
  for (const swarm of Object.values(state.swarms)) {
    for (const cardId of [...swarm.cardIds, ...swarm.broodLordIds]) {
      if (swarmCards.has(cardId)) add("SWARM_CARD_DUPLICATE", `${cardId} appears in multiple swarms`);
      swarmCards.add(cardId);
      if (state.components[cardId]?.containerId !== swarm.id) add("SWARM_CONTAINER", `${cardId} does not point to ${swarm.id}`);
    }
  }
  for (const component of Object.values(state.components)) {
    if (component.zone === "SWARM" && !swarmCards.has(component.instanceId)) add("SWARM_CARD_ORPHAN", `${component.instanceId} is zoned to a swarm but absent from one`);
  }

  const supportUsed = Object.values(state.marines).reduce((sum, marine) => sum + marine.support, 0)
    + Object.values(state.terrain).reduce((sum, terrain) => sum + terrain.support, 0)
    + Object.values(state.locationSupport).reduce((sum, support) => sum + support, 0);
  if (state.supportSupply + supportUsed !== 12) add("SUPPORT_CONSERVATION", `Support total is ${state.supportSupply + supportUsed}, expected 12`);

  if (state.activeTeams.length > 3 || new Set(state.activeTeams).size !== state.activeTeams.length) add("ACTIVE_TEAMS", "Solo state may have at most three unique surviving active teams");
  for (const color of TEAM_COLORS) {
    const team = state.teams[color];
    if (!team || team.color !== color || team.active !== state.activeTeams.includes(color)) add("TEAM_STATE", `${color} team state is inconsistent`);
  }
  const queuedActions = new Set(state.actionQueue);
  if (queuedActions.size !== state.actionQueue.length) add("ACTION_QUEUE_DUPLICATE", "An Action appears multiple times in the resolution queue");
  if (state.currentActionIndex < 0 || state.currentActionIndex > state.actionQueue.length) add("ACTION_QUEUE_INDEX", "Action queue index is out of range");
  for (const actionId of state.actionQueue) {
    const component = state.components[actionId];
    if (component?.kind !== "ACTION") add("ACTION_QUEUE_UNKNOWN", `${actionId} is not an Action card`);
  }
  if (state.actionRuntime) {
    const currentActionId = state.actionQueue[state.currentActionIndex];
    if (state.phase !== "RESOLVE_ACTIONS" || currentActionId !== state.actionRuntime.actionId) add("ACTION_RUNTIME", "Action runtime does not match the resolving queue entry");
    for (const field of ["movedMarineIds", "facingResolvedMarineIds", "activationResolvedMarineIds", "specialResolvedMarineIds"] as const) {
      const ids = state.actionRuntime[field];
      if (new Set(ids).size !== ids.length) add("ACTION_RUNTIME_DUPLICATE", `${field} contains duplicate Marine identities`);
      if (ids.some((id) => !state.components[id] || state.components[id].kind !== "MARINE")) add("ACTION_RUNTIME_MARINE", `${field} contains a non-Marine identity`);
    }
    if (state.actionStep === null) add("ACTION_RUNTIME_STEP", "Resolving Action runtime requires a step");
    if (new Set(state.actionRuntime.selectedCardIds).size !== state.actionRuntime.selectedCardIds.length) add("ACTION_RUNTIME_DUPLICATE", "selectedCardIds contains duplicate component identities");
  } else if (state.actionStep !== null) add("ACTION_RUNTIME_STEP", "Action step exists without runtime state");
  if (new Set(state.genestealerAttackQueue).size !== state.genestealerAttackQueue.length) add("GENESTEALER_ATTACK_QUEUE_DUPLICATE", "A swarm appears multiple times in the Genestealer attack queue");
  if (state.currentGenestealerAttackIndex < 0 || state.currentGenestealerAttackIndex > state.genestealerAttackQueue.length) add("GENESTEALER_ATTACK_QUEUE_INDEX", "Genestealer attack queue index is out of range");
  if (state.genestealerAttackRuntime) {
    if (state.phase !== "GENESTEALER_ATTACK") add("GENESTEALER_ATTACK_RUNTIME", "Genestealer attack runtime exists outside its phase");
    if (state.genestealerAttackQueue[state.currentGenestealerAttackIndex] !== state.genestealerAttackRuntime.swarmId) add("GENESTEALER_ATTACK_RUNTIME", "Runtime swarm does not match the queue entry");
    if (!state.marines[state.genestealerAttackRuntime.defenderMarineId]) add("GENESTEALER_ATTACK_DEFENDER", "Runtime defender is not a live Marine");
    if (state.genestealerAttackStep === null) add("GENESTEALER_ATTACK_STEP", "Hostile attack runtime requires a step");
  } else if (state.genestealerAttackStep !== null) add("GENESTEALER_ATTACK_STEP", "Hostile attack step exists without runtime state");
  if (state.travelRuntime && state.travelStep === null) add("TRAVEL_STEP", "Travel runtime requires a step");
  if (!state.travelRuntime && state.travelStep !== null) add("TRAVEL_STEP", "Travel step exists without runtime state");
  if (state.eventRuntime) {
    if (state.phase !== "EVENT") add("EVENT_RUNTIME", "Event runtime exists outside the Event phase");
    if (state.eventStep === null) add("EVENT_STEP", "Event runtime requires a step");
    if (new Set(state.eventRuntime.movedCardIds).size !== state.eventRuntime.movedCardIds.length) add("EVENT_MOVEMENT_DUPLICATE", "Event movement history contains duplicate cards");
  } else if (state.eventStep !== null) add("EVENT_STEP", "Event step exists without runtime state");
  if (state.pendingDecision) {
    const matches = state.pendingQueue.filter((checkpoint) => checkpoint.decisionId === state.pendingDecision?.id);
    if (matches.length !== 1) add("DECISION_CHECKPOINT", "Pending decision must have exactly one matching checkpoint");
    if (new Set(state.pendingDecision.legalOptions.map((option) => option.id)).size !== state.pendingDecision.legalOptions.length) add("DECISION_OPTIONS", "Decision option IDs must be unique");
    if (!state.pendingDecision.legalOptions.length) add("DECISION_OPTIONS", "Pending decision must contain a legal option");
  } else if (state.pendingQueue.some((checkpoint) => checkpoint.decisionId !== null)) {
    add("DECISION_ORPHAN", "A decision checkpoint exists without a pending decision");
  }
  if (state.components[state.setupLocationInstanceId]?.kind !== "SETUP_LOCATION") add("SETUP_LOCATION", "Setup Location identity is invalid");
  if (state.components[state.currentLocationInstanceId]?.zone !== "CURRENT") add("CURRENT_LOCATION", "Current Location is not in the CURRENT zone");
  if (state.phase === "GAME_OVER" && state.status === "IN_PROGRESS") add("GAME_STATUS", "GAME_OVER requires a final status");
  if (state.phase !== "GAME_OVER" && state.status !== "IN_PROGRESS") add("GAME_STATUS", "A final status requires GAME_OVER");
  return issues;
}

export function assertStateInvariants(state: GameState): void {
  const issues = validateState(state);
  if (issues.length) throw new Error(`State invariant failure:\n${issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n")}`);
}
