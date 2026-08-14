import type { GameState, PendingDecision } from "../state/game-state";
import { actionDefinition, MARINES } from "../actions/catalog";
import { makeDecision } from "../actions/support";

function marineDefinition(state: GameState, marineId: string) {
  return MARINES.find((marine) => marine.id === state.components[marineId].definitionId)!;
}

function marineName(state: GameState, marineId: string): string {
  return marineDefinition(state, marineId).name;
}

function positionOf(state: GameState, marineId: string): number {
  return state.formation.findIndex((slot) => slot.marineInstanceId === marineId);
}

function swarmLabel(state: GameState, swarmId: string): string {
  const swarm = state.swarms[swarmId];
  const count = swarm.cardIds.length + swarm.broodLordIds.length;
  return `F${swarm.positionIndex + 1} ${swarm.side} · ${count} Genestealer${count === 1 ? "" : "s"}`;
}

function isProtected(state: GameState, swarmId: string): boolean {
  return state.swarms[swarmId].effects.some((effect) => effect.data.cannotBeSlain === true);
}

export function legalAttackSwarms(state: GameState, marineId: string): string[] {
  const position = positionOf(state, marineId);
  const marine = state.marines[marineId];
  const range = marineDefinition(state, marineId).attackRange;
  return Object.values(state.swarms)
    .filter((swarm) => swarm.side === marine.facing && Math.abs(swarm.positionIndex - position) <= range)
    .filter((swarm) => !isProtected(state, swarm.id))
    .sort((a, b) => a.positionIndex - b.positionIndex || a.id.localeCompare(b.id))
    .map((swarm) => swarm.id);
}

export function heroicChargeSwarms(state: GameState, marineId: string): string[] {
  const position = positionOf(state, marineId);
  return Object.values(state.swarms)
    .filter((swarm) => Math.abs(swarm.positionIndex - position) <= 1 && !isProtected(state, swarm.id))
    .filter((swarm) => eligibleSlainCards(state, swarm.id).length > 0)
    .sort((a, b) => a.positionIndex - b.positionIndex || a.side.localeCompare(b.side) || a.id.localeCompare(b.id))
    .map((swarm) => swarm.id);
}

function attackCount(state: GameState, marineId: string): number {
  return Number(state.actionRuntime?.data[`attackCount.${marineId}`] ?? 0);
}

export function attackMarineDecision(state: GameState, actionId: string): PendingDecision | null {
  const action = actionDefinition(actionId);
  const runtime = state.actionRuntime!;
  const psionicCredits = Number(runtime.data.psionicBonusAttacks ?? 0);
  if (psionicCredits > 0) {
    const marineId = "marine.grey.lexicanium-calistarius";
    const evasionMarineId = runtime.data.evasionMarineId as string | undefined;
    if (state.roundEffects.some((effect) => effect.data.handlerId === "event.evasion" && Number(effect.data.activeRound) === state.round) && evasionMarineId && evasionMarineId !== marineId) return null;
    if (!state.marines[marineId] || legalAttackSwarms(state, marineId).length === 0) return null;
    return makeDecision(state, "ATTACK_MARINE", actionId, "attack.psionicBonus", [
      { id: `attack:${marineId}`, label: `${marineName(state, marineId)} · Make the additional attack`, payload: { marineId, bonus: true }, canonicalEffectPreview: "Resolve the immediate Psionic Attack" },
      { id: "decline-bonus", label: "Decline the additional attack", payload: { declineBonus: true }, canonicalEffectPreview: null },
    ]);
  }

  const options: PendingDecision["legalOptions"] = [];
  const evasionActive = state.roundEffects.some((effect) => effect.data.handlerId === "event.evasion" && Number(effect.data.activeRound) === state.round);
  const evasionMarineId = runtime.data.evasionMarineId as string | undefined;
  for (const marineId of state.teams[action.team].marineInstanceIds) {
    if (!state.marines[marineId]) continue;
    if (evasionActive && evasionMarineId && evasionMarineId !== marineId) continue;
    const fullAutoAvailable = action.handlerId === "action.full-auto"
      && marineId === "marine.red.brother-leon"
      && attackCount(state, marineId) < 3;
    const baseAvailable = !runtime.specialResolvedMarineIds.includes(marineId);
    if (!baseAvailable && !fullAutoAvailable) continue;
    const standardTargets = legalAttackSwarms(state, marineId);
    const heroicTargets = action.handlerId === "action.heroic-charge"
      && marineId === "marine.yellow.brother-claudio"
      ? heroicChargeSwarms(state, marineId)
      : [];
    if (!standardTargets.length && !heroicTargets.length) continue;
    options.push({
      id: `attack:${marineId}`,
      label: `${marineName(state, marineId)} · Attack${fullAutoAvailable ? ` (${attackCount(state, marineId) + 1} of 3)` : ""}`,
      payload: { marineId, bonus: false },
      canonicalEffectPreview: "Choose this Marine's target",
    });
  }
  if (!options.length) return null;
  options.push({ id: "finish", label: "Finish this Attack Action", payload: { finish: true }, canonicalEffectPreview: null });
  return makeDecision(state, "ATTACK_MARINE", actionId, "attack.chooseMarine", options);
}

export function attackTargetDecision(state: GameState, actionId: string, marineId: string): PendingDecision {
  const action = actionDefinition(actionId);
  const options: PendingDecision["legalOptions"] = legalAttackSwarms(state, marineId).map((swarmId) => ({
    id: `target:${swarmId}`,
    label: swarmLabel(state, swarmId),
    payload: { marineId, swarmId, heroicCharge: false },
    canonicalEffectPreview: `Attack ${swarmId}`,
  }));
  if (action.handlerId === "action.heroic-charge" && marineId === "marine.yellow.brother-claudio" && heroicChargeSwarms(state, marineId).length) {
    options.unshift({
      id: "heroic-charge",
      label: "Heroic Charge · Slay up to 3 within Range 1, ignoring facing",
      payload: { marineId, heroicCharge: true },
      canonicalEffectPreview: "Replace Claudio's attack with Heroic Charge",
    });
  }
  return makeDecision(state, "ATTACK_TARGET", actionId, "attack.chooseTarget", options);
}

export function runAndGunDecision(state: GameState, actionId: string, marineId: string): PendingDecision | null {
  if (state.marines[marineId].support < 1) return null;
  const targets = legalAttackSwarms(state, marineId);
  if (!targets.length) return null;
  const name = marineName(state, marineId);
  return makeDecision(state, "RUN_AND_GUN_ATTACK", actionId, "move.runAndGun", [
    { id: `skip:${marineId}`, label: `${name} · Do not attack`, payload: { attack: false, marineId }, canonicalEffectPreview: null },
    ...targets.map((swarmId) => ({
      id: `attack:${marineId}:${swarmId}`,
      label: `${name} · Spend 1 Support to attack ${swarmLabel(state, swarmId)}`,
      payload: { attack: true, marineId, swarmId },
      canonicalEffectPreview: `Attack ${swarmId}`,
    })),
  ]);
}

export function attackRerollDecision(state: GameState, actionId: string, marineId: string): PendingDecision | null {
  if (state.marines[marineId].support < 1) return null;
  return makeDecision(state, "ATTACK_REROLL", actionId, "attack.reroll", [
    { id: "keep", label: "Keep this die result", payload: { reroll: false, marineId }, canonicalEffectPreview: null },
    { id: "reroll", label: "Spend 1 Support to reroll", payload: { reroll: true, marineId }, canonicalEffectPreview: "Replace the current die result" },
  ]);
}

export function attackSlayDecision(
  state: GameState,
  actionId: string,
  swarmIds: string[],
  allowStop = false,
): PendingDecision | null {
  const options: PendingDecision["legalOptions"] = [];
  for (const swarmId of swarmIds) {
    for (const cardId of mechanicallyDistinctSlainCards(state, swarmId)) {
      options.push({
        id: `slay:${cardId}`,
        label: `${swarmLabel(state, swarmId)} · ${state.genestealers[cardId]?.icon ?? "BROOD LORD"} · ${cardId}`,
        payload: { cardId, swarmId, stop: false },
        canonicalEffectPreview: `Slay ${cardId}`,
      });
    }
  }
  if (!options.length) return null;
  if (allowStop) options.push({ id: "stop", label: "Stop slaying Genestealers", payload: { stop: true }, canonicalEffectPreview: null });
  return makeDecision(state, "ATTACK_SLAY", actionId, "attack.chooseSlain", options);
}

export function leadByExampleDecision(state: GameState, actionId: string): PendingDecision {
  return makeDecision(state, "LEAD_BY_EXAMPLE", actionId, "attack.leadByExample", [
    { id: "skip", label: "Do not place a Support Token", payload: { skip: true }, canonicalEffectPreview: null },
    ...state.formation.map((slot, index) => ({
      id: `marine:${slot.marineInstanceId}`,
      label: `F${index + 1} · ${marineName(state, slot.marineInstanceId)}`,
      payload: { skip: false, marineId: slot.marineInstanceId },
      canonicalEffectPreview: `Place 1 Support on ${marineName(state, slot.marineInstanceId)}`,
    })),
  ]);
}

export function eligibleSlainCards(state: GameState, swarmId: string): string[] {
  const swarm = state.swarms[swarmId];
  if (!swarm || isProtected(state, swarmId)) return [];
  return swarm.cardIds.length ? [...swarm.cardIds] : [...swarm.broodLordIds];
}

export function mechanicallyDistinctSlainCards(state: GameState, swarmId: string): string[] {
  const seen = new Set<string>();
  return eligibleSlainCards(state, swarmId).filter((cardId) => {
    const component = state.components[cardId];
    const effects = state.genestealers[cardId]?.effects ?? [];
    const signature = `${component.definitionId}:${JSON.stringify(effects)}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

export function slayGenestealer(state: GameState, swarmId: string, cardId: string): void {
  const swarm = state.swarms[swarmId];
  if (!swarm) throw new Error(`Missing target swarm: ${swarmId}`);
  if (!eligibleSlainCards(state, swarmId).includes(cardId)) throw new Error(`Ineligible Genestealer slay: ${cardId}`);
  const isBroodLord = swarm.broodLordIds.includes(cardId);
  swarm.cardIds = swarm.cardIds.filter((id) => id !== cardId);
  swarm.broodLordIds = swarm.broodLordIds.filter((id) => id !== cardId);
  const discardId = isBroodLord ? "brood-lord.discard" : "genestealer.discard";
  state.orderedSources[discardId].push(cardId);
  state.components[cardId].zone = "DISCARD";
  state.components[cardId].containerId = discardId;
  if (swarm.cardIds.length + swarm.broodLordIds.length === 0) {
    const slot = state.formation[swarm.positionIndex];
    slot.swarmIds[swarm.side] = slot.swarmIds[swarm.side].filter((id) => id !== swarmId);
    delete state.swarms[swarmId];
  }
}

export function slayMarine(state: GameState, marineId: string): void {
  const vacancy = positionOf(state, marineId);
  if (vacancy < 0) throw new Error(`Missing Marine in formation: ${marineId}`);
  const deadSlot = state.formation[vacancy];
  if (state.formation.length === 1) {
    for (const side of ["LEFT", "RIGHT"] as const) {
      for (const terrainId of deadSlot.terrainInstanceIds[side]) {
        state.supportSupply += state.terrain[terrainId].support;
        state.components[terrainId].zone = "DISCARD";
        state.components[terrainId].containerId = null;
        delete state.terrain[terrainId];
      }
      for (const swarmId of deadSlot.swarmIds[side]) {
        const swarm = state.swarms[swarmId];
        for (const cardId of swarm.cardIds) {
          state.orderedSources["genestealer.discard"].push(cardId);
          state.components[cardId].zone = "DISCARD";
          state.components[cardId].containerId = "genestealer.discard";
        }
        for (const cardId of swarm.broodLordIds) {
          state.orderedSources["brood-lord.discard"].push(cardId);
          state.components[cardId].zone = "DISCARD";
          state.components[cardId].containerId = "brood-lord.discard";
        }
        delete state.swarms[swarmId];
      }
    }
  }
  const above = vacancy;
  const below = state.formation.length - vacancy - 1;
  const mergeIndex = above === 0
    ? vacancy + 1
    : below === 0
      ? vacancy - 1
      : above < below ? vacancy - 1 : vacancy + 1;
  if (mergeIndex >= 0 && mergeIndex < state.formation.length) {
    const destination = state.formation[mergeIndex];
    for (const side of ["LEFT", "RIGHT"] as const) {
      destination.terrainInstanceIds[side].push(...deadSlot.terrainInstanceIds[side]);
      destination.swarmIds[side].push(...deadSlot.swarmIds[side]);
    }
  }
  state.formation.splice(vacancy, 1);
  state.supportSupply += state.marines[marineId].support;
  delete state.marines[marineId];
  state.components[marineId].zone = "SLAIN";
  state.components[marineId].containerId = null;

  state.formation.forEach((slot, positionIndex) => {
    state.components[slot.marineInstanceId].containerId = `formation.${positionIndex}`;
    for (const side of ["LEFT", "RIGHT"] as const) {
      for (const terrainId of slot.terrainInstanceIds[side]) {
        state.terrain[terrainId].positionIndex = positionIndex;
        state.components[terrainId].containerId = `formation.${positionIndex}.${side.toLowerCase()}`;
      }
      for (const swarmId of slot.swarmIds[side]) state.swarms[swarmId].positionIndex = positionIndex;
    }
  });

  const team = MARINES.find((marine) => marine.id === state.components[marineId].definitionId)!.team;
  if (state.teams[team].marineInstanceIds.every((id) => !state.marines[id])) {
    state.teams[team].active = false;
    state.activeTeams = state.activeTeams.filter((color) => color !== team);
    state.teams[team].chosenActionInstanceId = null;
    for (const actionId of state.teams[team].actionInstanceIds) {
      if (state.components[actionId].zone !== "RESOLVING") {
        state.components[actionId].zone = "REMOVED";
        state.components[actionId].containerId = null;
      }
    }
    if (state.currentPlayerTeam === team) {
      const next = state.activeTeams
        .map((color) => ({ color, actionId: state.teams[color].previousActionInstanceId }))
        .filter((entry): entry is { color: typeof team; actionId: string } => entry.actionId !== null)
        .sort((left, right) => actionDefinition(left.actionId).initiative - actionDefinition(right.actionId).initiative)[0];
      state.currentPlayerTeam = next?.color ?? null;
    }
  }
  if (Object.keys(state.marines).length === 0) {
    state.status = "DEFEAT";
    state.phase = "GAME_OVER";
  }
}
