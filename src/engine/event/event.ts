import type { Side, TeamColor } from "@/src/data/types";
import { BROOD_LORDS, MARINES, SOLO_SETUP, actionDefinition, eventDefinition, terrainDefinition } from "../actions/catalog";
import { makeDecision, mergeStrategizeDestination } from "../actions/support";
import { drawCard } from "../cards/draw-card";
import { eligibleSlainCards, legalAttackSwarms, mechanicallyDistinctSlainCards, slayGenestealer, slayMarine } from "../combat/attack";
import { travelRequired } from "../combat/defense";
import { Sha256CounterRng } from "../rng/sha256-counter";
import type { EffectState, GameState, PendingDecision, SwarmState } from "../state/game-state";
import { commitTransition } from "../transitions/commit";
import type { DecisionRecord, TransitionRecord } from "../transitions/types";
import { addGenestealerToSwarm, totalDoorSupport } from "../travel/location";

type Option = PendingDecision["legalOptions"][number];

function currentCard(state: GameState): string {
  const id = state.eventRuntime?.eventCardId;
  if (!id) throw new Error("Event runtime has no current card");
  return id;
}

function marineName(state: GameState, marineId: string): string {
  return MARINES.find((marine) => marine.id === state.components[marineId].definitionId)!.name;
}

function positionOf(state: GameState, marineId: string): number {
  return state.formation.findIndex((slot) => slot.marineInstanceId === marineId);
}

function swarmLabel(swarm: SwarmState): string {
  const count = swarm.cardIds.length + swarm.broodLordIds.length;
  return `F${swarm.positionIndex + 1} ${swarm.side} · ${count} Genestealer${count === 1 ? "" : "s"}`;
}

function opposite(side: Side): Side { return side === "LEFT" ? "RIGHT" : "LEFT"; }

function permutations<T>(items: T[]): T[][] {
  if (items.length < 2) return [items];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

function request(state: GameState, decision: PendingDecision, transitions: TransitionRecord[]): void {
  const checkpoint = { id: `checkpoint.${state.transitionSeq + 1}.${decision.type.toLowerCase()}`, sourceId: decision.sourceId, timing: state.phase, kind: "DECISION" as const, mandatory: true, affectedIds: decision.legalOptions.map((option) => option.id), decisionId: decision.id };
  transitions.push(commitTransition(state, "DECISION_REQUESTED", decision.sourceId, () => {
    state.pendingDecision = decision;
    state.pendingQueue.push(checkpoint);
  }, { generatedCheckpoints: [checkpoint.id] }));
}

function clear(state: GameState, decision: PendingDecision): void {
  state.pendingDecision = null;
  state.pendingQueue = state.pendingQueue.filter((checkpoint) => checkpoint.decisionId !== decision.id);
}

function markSpecialUnavailable(state: GameState, transitions: TransitionRecord[], mutate?: () => void): void {
  transitions.push(commitTransition(state, "EVENT_SPECIAL_UNAVAILABLE", currentCard(state), () => {
    mutate?.();
    state.eventRuntime!.data.specialResolved = true;
    state.eventStep = "SPECIAL";
  }));
}

function marinesDecision(state: GameState, purpose: string, ids: string[], includeSkip = false): PendingDecision | null {
  const options: Option[] = ids.map((marineId) => {
    const positionIndex = positionOf(state, marineId);
    return {
      id: `marine:${marineId}`,
      label: positionIndex >= 0 ? `F${positionIndex + 1} · ${marineName(state, marineId)}` : marineName(state, marineId),
      payload: { purpose, marineId },
      canonicalEffectPreview: purpose === "rescue" ? "Return at the bottom of the formation facing right" : null,
    };
  });
  if (includeSkip) options.push({ id: "skip", label: "Skip this effect", payload: { purpose, skip: true }, canonicalEffectPreview: null });
  return options.length ? makeDecision(state, "EVENT_MARINE", currentCard(state), `event.${purpose}`, options) : null;
}

function swarmsDecision(state: GameState, purpose: string, ids: string[]): PendingDecision | null {
  const options = ids.filter((id) => state.swarms[id]).map((swarmId) => ({ id: `swarm:${swarmId}`, label: swarmLabel(state.swarms[swarmId]), payload: { purpose, swarmId }, canonicalEffectPreview: null }));
  return options.length ? makeDecision(state, "EVENT_SWARM", currentCard(state), `event.${purpose}`, options) : null;
}

function blipDecision(state: GameState, purpose: string, sides: Side[]): PendingDecision | null {
  const options = sides.map((side) => ({ id: `side:${side}`, label: `${side} blip · ${state.orderedSources[side === "LEFT" ? "blip.left" : "blip.right"].length} cards`, payload: { purpose, side }, canonicalEffectPreview: null }));
  return options.length ? makeDecision(state, "EVENT_BLIP", currentCard(state), `event.${purpose}`, options) : null;
}

function teamDecision(state: GameState, teams: TeamColor[]): PendingDecision | null {
  const options = teams.map((team) => ({ id: `team:${team}`, label: `${team} Combat Team`, payload: { team }, canonicalEffectPreview: "Cannot play its Attack Action next round" }));
  return options.length ? makeDecision(state, "EVENT_TEAM", currentCard(state), "event.gunJam", options) : null;
}

function engagedSwarms(state: GameState, marineId: string): string[] {
  const position = positionOf(state, marineId);
  return Object.values(state.swarms).filter((swarm) => swarm.positionIndex === position).sort((a, b) => a.side.localeCompare(b.side) || a.id.localeCompare(b.id)).map((swarm) => swarm.id);
}

function addNextRoundEffect(state: GameState, handlerId: string, targetIds: string[]): void {
  const effect: EffectState = {
    id: `effect.round-${state.round + 1}.${handlerId}.${state.transitionSeq + 1}`,
    sourceId: currentCard(state), startTiming: "NEXT_ROUND", expiryTiming: "END_OF_ROUND",
    targetIds, mergePropagation: "NONE",
    data: { handlerId, activeRound: state.round + 1, expiryRound: state.round + 1 },
  };
  state.roundEffects.push(effect);
}

function mergeAll(state: GameState): void {
  for (const slot of state.formation) for (const side of ["LEFT", "RIGHT"] as const) {
    const ids = slot.swarmIds[side].filter((id) => state.swarms[id]);
    if (ids.length > 1) mergeStrategizeDestination(state, ids[0]);
  }
}

function moveSwarm(state: GameState, swarmId: string, positionIndex: number, side: Side): void {
  const swarm = state.swarms[swarmId];
  if (!swarm) return;
  state.formation[swarm.positionIndex].swarmIds[swarm.side] = state.formation[swarm.positionIndex].swarmIds[swarm.side].filter((id) => id !== swarmId);
  swarm.positionIndex = positionIndex;
  swarm.side = side;
  state.formation[positionIndex].swarmIds[side].push(swarmId);
  mergeStrategizeDestination(state, swarmId);
}

function moveAllToMarine(state: GameState, marineId: string, flank: boolean): void {
  const position = positionOf(state, marineId);
  const behind = opposite(state.marines[marineId].facing);
  for (const swarmId of Object.keys(state.swarms).sort()) {
    const swarm = state.swarms[swarmId];
    moveSwarm(state, swarmId, position, flank ? behind : swarm.side);
  }
  mergeAll(state);
}

function discardSupport(state: GameState, marineId: string, count: number): number {
  const actual = Math.min(count, state.marines[marineId]?.support ?? 0);
  if (state.marines[marineId]) state.marines[marineId].support -= actual;
  state.supportSupply += actual;
  return actual;
}

function roll(state: GameState, sourceId: string, purpose: string, nextStep: string, transitions: TransitionRecord[]): void {
  const rng = Sha256CounterRng.restore(state.rng);
  const face = rng.rollCombatDie();
  const resultingRng = rng.snapshot();
  const prior = state.activeDie;
  transitions.push(commitTransition(state, prior?.purpose === purpose ? "DIE_REROLLED" : "DIE_ROLLED", sourceId, () => {
    state.rng = resultingRng;
    state.activeDie = { id: prior?.purpose === purpose ? prior.id : `die.${state.transitionSeq + 1}`, sourceId, purpose, rawValue: face.value, skull: face.skull, modifiedValue: face.value, rerolls: prior?.purpose === purpose ? [...prior.rerolls, { rawValue: prior.rawValue, skull: prior.skull, modifiedValue: prior.modifiedValue }] : [] };
    state.eventStep = nextStep;
  }, { randomInputs: [{ operationSeq: resultingRng.operationSeq, kind: "DIE", sourceId, cardId: null, preLength: null, postLength: null, resultingRng, dieValue: face.value, dieSkull: face.skull }] }));
}

function drawGenestealer(state: GameState, side: Side, positionIndex: number | null, spawnSide: Side | null, transitions: TransitionRecord[], after?: () => void): boolean {
  const source = side === "LEFT" ? "blip.left" : "blip.right";
  if (!state.orderedSources[source].length) return false;
  const rng = Sha256CounterRng.restore(state.rng);
  const destination = positionIndex === null ? { zone: side === "LEFT" ? "LEFT_BLIP" as const : "RIGHT_BLIP" as const, containerId: source } : { zone: "SWARM" as const, containerId: null };
  const result = drawCard(state, rng, source, destination, (cardId) => {
    if (positionIndex !== null && spawnSide !== null) addGenestealerToSwarm(state, cardId, positionIndex, spawnSide);
    after?.();
  });
  transitions.push(...result.transitions);
  return true;
}

function eventAttackDecision(state: GameState, purpose: string, marineIds: string[], spendSupport: boolean): PendingDecision | null {
  const options: Option[] = [{ id: "finish", label: purpose === "overwatch" ? "Finish Overwatch attacks" : "Skip the attack", payload: { purpose, finish: true }, canonicalEffectPreview: null }];
  for (const marineId of marineIds) {
    if (spendSupport && state.marines[marineId].support < 1) continue;
    for (const swarmId of legalAttackSwarms(state, marineId)) options.unshift({ id: `attack:${marineId}:${swarmId}`, label: `${marineName(state, marineId)} → ${swarmLabel(state.swarms[swarmId])}`, payload: { purpose, marineId, swarmId, finish: false }, canonicalEffectPreview: spendSupport ? "Spend 1 Support and attack" : "Make 1 attack" });
  }
  return options.length > 1 ? makeDecision(state, "EVENT_ATTACK", currentCard(state), `event.${purpose}.attack`, options) : null;
}

function slayDecision(state: GameState, purpose: string, swarmIds: string[], remaining: number, allowStop = false): PendingDecision | null {
  const options: Option[] = [];
  for (const swarmId of swarmIds) for (const cardId of mechanicallyDistinctSlainCards(state, swarmId)) options.push({ id: `slay:${cardId}`, label: `${swarmLabel(state.swarms[swarmId])} · ${state.genestealers[cardId]?.icon ?? "BROOD LORD"}`, payload: { purpose, swarmId, cardId, stop: false }, canonicalEffectPreview: `Slay ${cardId}` });
  if (allowStop) options.push({ id: "stop", label: "Finish slaying", payload: { purpose, stop: true }, canonicalEffectPreview: null });
  return options.length ? makeDecision(state, "EVENT_SLAY", currentCard(state), `event.${purpose}.slay.${remaining}`, options) : null;
}

export function handlesEventDecision(type: string): boolean {
  return ["EVENT_MARINE", "EVENT_SWARM", "EVENT_BLIP", "EVENT_TEAM", "EVENT_COUNT", "EVENT_SLAY", "EVENT_ATTACK", "EVENT_ATTACK_REROLL", "EVENT_ATTACK_SLAY", "EVENT_SPAWN_PRIORITY", "ENTER_FORMATION_SUPPORT"].includes(type);
}

export function applyEventDecision(state: GameState, pending: PendingDecision, option: Option, decisionRecord: DecisionRecord): TransitionRecord {
  return commitTransition(state, "EVENT_DECISION_RESOLVED", pending.sourceId, () => {
    clear(state, pending);
    const runtime = state.eventRuntime;
    if (pending.type === "ENTER_FORMATION_SUPPORT") {
      const actionId = option.payload.actionId as string;
      if (!option.payload.skip) { state.supportSupply -= 1; state.marines[option.payload.marineId as string].support += 1; }
      const effect = state.roundEffects.find((item) => item.data.handlerId === "event.enter-formation" && Number(item.data.activeRound) === state.round);
      if (effect) effect.data[`used.${actionId}`] = true;
      return;
    }
    if (!runtime) throw new Error("Event decision without Event runtime");
    const purpose = option.payload.purpose as string | undefined;
    if (pending.type === "EVENT_MARINE") {
      if (option.payload.skip) { runtime.data.specialResolved = true; return; }
      const marineId = option.payload.marineId as string;
      runtime.data.marineId = marineId;
      if (purpose === "surrounded") { moveAllToMarine(state, marineId, false); runtime.data.specialResolved = true; }
      else if (purpose === "stalking") { discardSupport(state, marineId, state.marines[marineId].support); runtime.data.specialResolved = true; }
      else if (purpose === "resupply") {
        const total = Object.keys(state.marines).reduce((sum, id) => sum + (id === marineId ? 0 : discardSupport(state, id, state.marines[id].support)), 0);
        state.supportSupply -= total; state.marines[marineId].support += total; runtime.data.specialResolved = true;
      } else if (purpose === "second-wind") { addNextRoundEffect(state, "event.second-wind", [marineId]); runtime.data.specialResolved = true; }
      else if (purpose === "out-of-thin-air") { runtime.data.remaining = 2; state.eventStep = "SPECIAL_SPAWN"; }
      else if (purpose === "psychic-assault" || purpose === "cleansing-flames") state.eventStep = "SPECIAL_ROLL";
      else if (purpose === "quick-instincts") state.eventStep = "SPECIAL_ATTACK";
      else if (purpose === "for-my-battle-brothers") { discardSupport(state, marineId, 1); runtime.data.remaining = 1; state.eventStep = "SPECIAL_SLAY"; }
      else if (purpose === "rewarded-faith") state.eventStep = "SPECIAL_COUNT";
      else if (purpose === "rescue") {
        const team = MARINES.find((marine) => marine.id === state.components[marineId].definitionId)!.team;
        const positionIndex = state.formation.length;
        state.marines[marineId] = { instanceId: marineId, facing: "RIGHT", support: 0, effects: [] };
        state.formation.push({ marineInstanceId: marineId, terrainInstanceIds: { LEFT: [], RIGHT: [] }, swarmIds: { LEFT: [], RIGHT: [] } });
        state.components[marineId].zone = "FORMATION";
        state.components[marineId].containerId = `formation.${positionIndex}`;
        state.teams[team].active = true;
        if (!state.activeTeams.includes(team)) state.activeTeams.push(team);
        runtime.data.specialResolved = true;
      }
    } else if (pending.type === "EVENT_SWARM") {
      runtime.data.swarmId = option.payload.swarmId as string;
      if (purpose === "temporary-sanctuary") state.eventStep = "SPECIAL_BLIP";
    } else if (pending.type === "EVENT_BLIP") {
      const side = option.payload.side as Side;
      if (purpose === "full-scan") {
        runtime.data.side = side;
        state.eventStep = "SPECIAL_FULL_SCAN";
      } else if (purpose === "temporary-sanctuary") { runtime.data.side = side; state.eventStep = "SPECIAL_APPLY"; }
    } else if (pending.type === "EVENT_TEAM") {
      addNextRoundEffect(state, "event.gun-jam", [option.payload.team as TeamColor]); runtime.data.specialResolved = true;
    } else if (pending.type === "EVENT_COUNT") {
      const marineId = runtime.data.marineId as string;
      const count = Number(option.payload.count);
      discardSupport(state, marineId, count); runtime.data.remaining = count; runtime.data.specialResolved = count === 0; state.eventStep = count === 0 ? "SPECIAL" : "SPECIAL_SLAY";
    } else if (pending.type === "EVENT_SLAY") {
      if (!option.payload.stop) { slayGenestealer(state, option.payload.swarmId as string, option.payload.cardId as string); runtime.data.remaining = Number(runtime.data.remaining) - 1; }
      if (option.payload.stop || Number(runtime.data.remaining) <= 0) { runtime.data.specialResolved = true; state.eventStep = "SPECIAL"; }
    } else if (pending.type === "EVENT_ATTACK") {
      if (option.payload.finish) { runtime.data.specialResolved = true; if (purpose === "overwatch") runtime.data.overwatchResolved = true; return; }
      const marineId = option.payload.marineId as string;
      if (purpose === "overwatch") { discardSupport(state, marineId, 1); runtime.processedMarineIds.push(marineId); }
      runtime.data.attackPurpose = purpose!; runtime.data.marineId = marineId; runtime.data.swarmId = option.payload.swarmId as string; state.eventStep = purpose === "overwatch" ? "END_ATTACK_ROLL" : "SPECIAL_ATTACK_ROLL";
    } else if (pending.type === "EVENT_ATTACK_REROLL") {
      if (option.payload.reroll) { discardSupport(state, runtime.data.marineId as string, 1); state.eventStep = runtime.data.attackPurpose === "overwatch" ? "END_ATTACK_ROLL" : "SPECIAL_ATTACK_ROLL"; }
      else state.eventStep = runtime.data.attackPurpose === "overwatch" ? "END_ATTACK_RESOLVE" : "SPECIAL_ATTACK_RESOLVE";
    } else if (pending.type === "EVENT_ATTACK_SLAY") {
      slayGenestealer(state, option.payload.swarmId as string, option.payload.cardId as string);
      state.activeDie = null;
      state.eventStep = runtime.data.attackPurpose === "overwatch" ? "END_EFFECTS" : "SPECIAL";
      if (runtime.data.attackPurpose !== "overwatch") runtime.data.specialResolved = true;
    } else if (pending.type === "EVENT_SPAWN_PRIORITY") {
      runtime.spawnTerrainIds = (option.payload.order as string).split(",").filter(Boolean); runtime.data.spawnPerTerrain = Number(option.payload.spawnPerTerrain); state.eventStep = "ACTIVATION_SPAWN";
    }
  }, { playerDecision: decisionRecord });
}

function resolveSpecial(state: GameState, transitions: TransitionRecord[]): boolean {
  const runtime = state.eventRuntime!;
  const cardId = currentCard(state);
  const event = eventDefinition(cardId);
  const handler = event.handlerId;
  if (runtime.data.specialResolved === true) {
    transitions.push(commitTransition(state, "EVENT_SPECIAL_RESOLVED", cardId, () => { state.eventStep = "ACTIVATION_PREP"; }));
    return true;
  }
  const allMarines = state.formation.map((slot) => slot.marineInstanceId);
  if (handler === "event.flanking-manoeuvre") {
    transitions.push(commitTransition(state, "EVENT_SPECIAL_APPLIED", cardId, () => { for (const swarm of Object.values(state.swarms)) { const marineId = state.formation[swarm.positionIndex].marineInstanceId; moveSwarm(state, swarm.id, swarm.positionIndex, opposite(state.marines[marineId].facing)); } mergeAll(state); runtime.data.specialResolved = true; })); return true;
  }
  if (handler === "event.theyre-everywhere") {
    const target = allMarines.find((marineId) => !runtime.processedMarineIds.includes(marineId) && engagedSwarms(state, marineId).length === 0);
    if (!target) { markSpecialUnavailable(state, transitions); return true; }
    const side = state.marines[target].facing; const source = side === "LEFT" ? "blip.left" : "blip.right";
    if (!state.orderedSources[source].length) { transitions.push(commitTransition(state, "EVENT_SPAWN_UNAVAILABLE", cardId, () => { runtime.processedMarineIds.push(target); })); return true; }
    drawGenestealer(state, side, positionOf(state, target), side, transitions, () => { runtime.processedMarineIds.push(target); }); return true;
  }
  if (handler === "event.the-swarm") {
    const remaining = Number(runtime.data.remaining ?? 4);
    if (remaining <= 0) { markSpecialUnavailable(state, transitions); return true; }
    const side: Side = remaining > 2 ? "LEFT" : "RIGHT";
    const rng = Sha256CounterRng.restore(state.rng);
    const result = drawCard(state, rng, "genestealer.deck", { zone: side === "LEFT" ? "LEFT_BLIP" : "RIGHT_BLIP", containerId: side === "LEFT" ? "blip.left" : "blip.right" }, (genId) => {
      state.orderedSources[side === "LEFT" ? "blip.left" : "blip.right"].push(genId); runtime.data.remaining = remaining - 1;
    }); transitions.push(...result.transitions); return true;
  }
  if (handler === "event.evasion") { transitions.push(commitTransition(state, "EVENT_EFFECT_REGISTERED", cardId, () => { addNextRoundEffect(state, handler, allMarines); runtime.data.specialResolved = true; })); return true; }
  if (handler === "event.outnumbered") { transitions.push(commitTransition(state, "SUPPORT_DISCARDED", cardId, () => { for (const marineId of allMarines) if (engagedSwarms(state, marineId).length) discardSupport(state, marineId, state.marines[marineId].support); runtime.data.specialResolved = true; })); return true; }
  if (handler === "event.chaos-of-battle") { transitions.push(commitTransition(state, "MARINES_FLIPPED", cardId, () => { for (const marineId of allMarines) state.marines[marineId].facing = opposite(state.marines[marineId].facing); runtime.data.specialResolved = true; })); return true; }
  if (handler === "event.secret-route") { transitions.push(commitTransition(state, "DOOR_SUPPORT_PLACED", cardId, () => { const door = Object.values(state.terrain).find((terrain) => terrainDefinition(terrain.instanceId).handlerId === "terrain.door"); if (door) { const count = Math.min(2, state.supportSupply); state.supportSupply -= count; door.support += count; } runtime.data.specialResolved = true; })); return true; }
  if (handler === "event.enter-formation") { transitions.push(commitTransition(state, "EVENT_EFFECT_REGISTERED", cardId, () => { addNextRoundEffect(state, handler, allMarines); runtime.data.specialResolved = true; })); return true; }
  if (handler === "event.rescue-space-marine") {
    const slain = Object.values(state.components).filter((component) => component.kind === "MARINE" && component.zone === "SLAIN" && state.teams[MARINES.find((marine) => marine.id === component.definitionId)!.team].active).map((component) => component.instanceId);
    if (!slain.length) { markSpecialUnavailable(state, transitions); return true; }
    request(state, marinesDecision(state, "rescue", slain, true)!, transitions); return false;
  }
  const decision = handler === "event.surrounded" ? marinesDecision(state, "surrounded", allMarines)
    : handler === "event.out-of-thin-air" ? marinesDecision(state, "out-of-thin-air", allMarines)
      : handler === "event.psychic-assault" ? marinesDecision(state, "psychic-assault", allMarines)
        : handler === "event.stalking-from-the-shadows" ? marinesDecision(state, "stalking", allMarines.filter((id) => state.marines[id].support > 0))
          : handler === "event.resupply" ? marinesDecision(state, "resupply", allMarines)
            : handler === "event.for-my-battle-brothers" ? marinesDecision(state, "for-my-battle-brothers", allMarines.filter((id) => state.marines[id].support > 0))
              : handler === "event.rewarded-faith" ? marinesDecision(state, "rewarded-faith", allMarines)
                : handler === "event.cleansing-flames" ? marinesDecision(state, "cleansing-flames", allMarines)
                  : handler === "event.second-wind" ? marinesDecision(state, "second-wind", allMarines)
                    : handler === "event.quick-instincts" ? marinesDecision(state, "quick-instincts", allMarines)
                      : null;
  if (handler === "event.gun-jam") {
    const teams = state.activeTeams.filter((team) => state.teams[team].previousActionInstanceId && actionDefinition(state.teams[team].previousActionInstanceId!).type !== "ATTACK");
    const choice = teamDecision(state, teams); if (choice) { request(state, choice, transitions); return false; } markSpecialUnavailable(state, transitions); return true;
  }
  if (handler === "event.full-scan") {
    const sides = (["LEFT", "RIGHT"] as const).filter((side) => state.orderedSources[side === "LEFT" ? "blip.left" : "blip.right"].length > 0);
    const choice = blipDecision(state, "full-scan", [...sides]); if (choice) { request(state, choice, transitions); return false; } markSpecialUnavailable(state, transitions); return true;
  }
  if (handler === "event.temporary-sanctuary") {
    const choice = swarmsDecision(state, "temporary-sanctuary", Object.keys(state.swarms)); if (choice) { request(state, choice, transitions); return false; } markSpecialUnavailable(state, transitions); return true;
  }
  if (decision) { request(state, decision, transitions); return false; }
  markSpecialUnavailable(state, transitions); return true;
}

function advanceSpecialSubstep(state: GameState, transitions: TransitionRecord[]): boolean {
  const runtime = state.eventRuntime!; const event = eventDefinition(currentCard(state)); const marineId = runtime.data.marineId as string;
  if (state.eventStep === "SPECIAL_SPAWN") {
    if (Number(runtime.data.remaining) <= 0) { markSpecialUnavailable(state, transitions); return true; }
    const side = opposite(state.marines[marineId].facing);
    if (!drawGenestealer(state, side, positionOf(state, marineId), side, transitions, () => { runtime.data.remaining = Number(runtime.data.remaining) - 1; })) markSpecialUnavailable(state, transitions);
    return true;
  }
  if (state.eventStep === "SPECIAL_ROLL") { roll(state, currentCard(state), event.handlerId, "SPECIAL_ROLL_RESOLVE", transitions); return true; }
  if (state.eventStep === "SPECIAL_ROLL_RESOLVE") {
    if (event.handlerId === "event.psychic-assault") {
      transitions.push(commitTransition(state, state.activeDie!.rawValue < 2 ? "MARINE_SLAIN" : "EVENT_ROLL_SURVIVED", currentCard(state), () => { if (state.activeDie!.rawValue < 2) slayMarine(state, marineId); runtime.data.specialResolved = true; state.eventStep = "SPECIAL"; })); return true;
    }
    transitions.push(commitTransition(state, "EVENT_ROLL_RESOLVED", currentCard(state), () => { runtime.data.remaining = state.activeDie!.skull ? 2 : 0; if (Number(runtime.data.remaining) > 0) state.eventStep = "SPECIAL_SLAY"; else { runtime.data.specialResolved = true; state.eventStep = "SPECIAL"; } })); return true;
  }
  if (state.eventStep === "SPECIAL_COUNT") {
    const max = Math.min(state.marines[marineId].support, engagedSwarms(state, marineId).reduce((sum, id) => sum + eligibleSlainCards(state, id).length, 0));
    const options: Option[] = Array.from({ length: max + 1 }, (_, count) => ({ id: `count:${count}`, label: count === 0 ? "Spend no Support" : `Spend ${count} Support to slay ${count}`, payload: { count }, canonicalEffectPreview: null }));
    request(state, makeDecision(state, "EVENT_COUNT", currentCard(state), "event.rewardedFaith.count", options), transitions); return false;
  }
  if (state.eventStep === "SPECIAL_SLAY") {
    const remaining = Number(runtime.data.remaining ?? 0); if (remaining <= 0) { markSpecialUnavailable(state, transitions); return true; }
    const choice = slayDecision(state, event.handlerId, engagedSwarms(state, marineId), remaining, event.handlerId === "event.rewarded-faith");
    if (choice) { request(state, choice, transitions); return false; } markSpecialUnavailable(state, transitions); return true;
  }
  if (state.eventStep === "SPECIAL_ATTACK") {
    const choice = eventAttackDecision(state, "quick-instincts", [marineId], false); if (choice) { request(state, choice, transitions); return false; } markSpecialUnavailable(state, transitions); return true;
  }
  if (state.eventStep === "SPECIAL_BLIP") {
    const left = state.orderedSources["blip.left"].length, right = state.orderedSources["blip.right"].length;
    const sides: Side[] = left === right ? ["LEFT", "RIGHT"] : [left < right ? "LEFT" : "RIGHT"];
    request(state, blipDecision(state, "temporary-sanctuary", sides)!, transitions); return false;
  }
  if (state.eventStep === "SPECIAL_FULL_SCAN") {
    const side = runtime.data.side as Side;
    const source = side === "LEFT" ? "blip.left" : "blip.right";
    if (!state.orderedSources[source].length) { markSpecialUnavailable(state, transitions); return true; }
    const rng = Sha256CounterRng.restore(state.rng);
    const result = drawCard(state, rng, source, { zone: "DISCARD", containerId: "genestealer.discard" }, (cardId) => {
      state.orderedSources["genestealer.discard"].push(cardId);
      runtime.data.specialResolved = true;
      state.eventStep = "SPECIAL";
    });
    transitions.push(...result.transitions);
    return true;
  }
  if (state.eventStep === "SPECIAL_APPLY") {
    const swarmId = runtime.data.swarmId as string, swarm = state.swarms[swarmId], side = runtime.data.side as Side;
    if (!swarm) { markSpecialUnavailable(state, transitions); return true; }
    const source = side === "LEFT" ? "blip.left" : "blip.right"; const moved = [...swarm.cardIds]; const rng = Sha256CounterRng.restore(state.rng); const shuffled = rng.shuffle([...state.orderedSources[source], ...moved]); const resultingRng = rng.snapshot();
    transitions.push(commitTransition(state, "SWARM_RETURNED_TO_BLIP", currentCard(state), () => {
      state.rng = resultingRng; state.orderedSources[source] = shuffled; for (const id of moved) { state.components[id].zone = side === "LEFT" ? "LEFT_BLIP" : "RIGHT_BLIP"; state.components[id].containerId = source; } swarm.cardIds = []; if (!swarm.broodLordIds.length) { state.formation[swarm.positionIndex].swarmIds[swarm.side] = state.formation[swarm.positionIndex].swarmIds[swarm.side].filter((id) => id !== swarmId); delete state.swarms[swarmId]; } runtime.data.specialResolved = true; state.eventStep = "SPECIAL";
    }, { randomInputs: [{ operationSeq: resultingRng.operationSeq, kind: "SHUFFLE", sourceId: source, cardId: null, preLength: shuffled.length, postLength: shuffled.length, resultingRng }] })); return true;
  }
  if (["SPECIAL_ATTACK_ROLL", "END_ATTACK_ROLL"].includes(state.eventStep!)) { roll(state, currentCard(state), `EVENT_ATTACK:${runtime.data.attackPurpose}`, state.eventStep === "END_ATTACK_ROLL" ? "END_ATTACK_REROLL" : "SPECIAL_ATTACK_REROLL", transitions); return true; }
  if (["SPECIAL_ATTACK_REROLL", "END_ATTACK_REROLL"].includes(state.eventStep!)) {
    const attacker = runtime.data.marineId as string; if (state.marines[attacker]?.support > 0) { request(state, makeDecision(state, "EVENT_ATTACK_REROLL", currentCard(state), "event.attack.reroll", [{ id: "keep", label: "Keep result", payload: { reroll: false }, canonicalEffectPreview: null }, { id: "reroll", label: "Spend 1 Support to reroll", payload: { reroll: true }, canonicalEffectPreview: null }]), transitions); return false; }
    state.eventStep = state.eventStep === "END_ATTACK_REROLL" ? "END_ATTACK_RESOLVE" : "SPECIAL_ATTACK_RESOLVE"; return true;
  }
  if (["SPECIAL_ATTACK_RESOLVE", "END_ATTACK_RESOLVE"].includes(state.eventStep!)) {
    const swarmId = runtime.data.swarmId as string; const eligible = eligibleSlainCards(state, swarmId); const distinctEligible = mechanicallyDistinctSlainCards(state, swarmId); const hit = state.activeDie?.skull && eligible.length;
    if (hit && distinctEligible.length > 1) {
      request(state, makeDecision(state, "EVENT_ATTACK_SLAY", currentCard(state), "event.attack.slay", distinctEligible.map((cardId) => ({ id: `slay:${cardId}`, label: `${swarmLabel(state.swarms[swarmId])} · ${state.genestealers[cardId]?.icon ?? "BROOD LORD"}`, payload: { swarmId, cardId }, canonicalEffectPreview: `Slay ${cardId}` }))), transitions);
      return false;
    }
    transitions.push(commitTransition(state, hit ? "GENESTEALER_SLAIN" : "ATTACK_MISSED", currentCard(state), () => { if (hit) slayGenestealer(state, swarmId, distinctEligible[0]); state.activeDie = null; if (runtime.data.attackPurpose === "overwatch") state.eventStep = "END_EFFECTS"; else { runtime.data.specialResolved = true; state.eventStep = "SPECIAL"; } })); return true;
  }
  return false;
}

function swarmActivates(state: GameState, swarm: SwarmState, icon: string): boolean {
  if (swarm.cardIds.some((id) => state.genestealers[id].icon === icon)) return true;
  return swarm.broodLordIds.some((id) => BROOD_LORDS.find((definition) => definition.id === state.components[id].definitionId)?.movementIcons.includes(icon as never));
}

function endRound(state: GameState): void {
  const endingRound = state.round;
  state.roundEffects = state.roundEffects.filter((effect) => Number(effect.data.expiryRound ?? endingRound) > endingRound);
  for (const swarm of Object.values(state.swarms)) { swarm.attackedThisAttackPhase = false; swarm.effects = swarm.effects.filter((effect) => effect.expiryTiming !== "END_OF_ROUND"); }
  for (const marine of Object.values(state.marines)) marine.effects = marine.effects.filter((effect) => effect.expiryTiming !== "END_OF_ROUND");
  for (const genestealer of Object.values(state.genestealers)) genestealer.movedOrFlankedThisEvent = false;
  for (const terrain of Object.values(state.terrain)) terrain.activatedThisRound = false;
  for (const team of state.activeTeams) state.teams[team].chosenActionInstanceId = null;
  state.round += 1; state.phase = "CHOOSE_ACTIONS"; state.currentPlayerTeam = null; state.eventStep = null; state.eventRuntime = null; state.activeDie = null;
}

export function advanceEvent(state: GameState, transitions: TransitionRecord[]): boolean {
  if (!state.eventRuntime) {
    transitions.push(commitTransition(state, "EVENT_STARTED", "EVENT", () => { state.pendingQueue = state.pendingQueue.filter((checkpoint) => checkpoint.sourceId !== "EVENT"); state.eventRuntime = { eventCardId: null, activationIndex: 0, spawnTerrainIds: [], movementQueue: [], selectedCardIds: [], processedMarineIds: [], movedCardIds: [], data: {} }; state.eventStep = "DRAW"; })); return true;
  }
  const runtime = state.eventRuntime;
  if (state.eventStep === "DRAW") {
    const rng = Sha256CounterRng.restore(state.rng); const result = drawCard(state, rng, "event.deck", { zone: "RESOLVING", containerId: null }, (cardId) => { runtime.eventCardId = cardId; state.eventStep = "SPECIAL"; }); transitions.push(...result.transitions); return true;
  }
  if (state.eventStep === "SPECIAL") return resolveSpecial(state, transitions);
  if (state.eventStep?.startsWith("SPECIAL_") || state.eventStep?.startsWith("END_ATTACK_")) return advanceSpecialSubstep(state, transitions);
  if (state.eventStep === "ACTIVATION_PREP") {
    const activation = eventDefinition(currentCard(state)).activations[runtime.activationIndex];
    if (!activation) { transitions.push(commitTransition(state, "EVENT_ACTIVATIONS_RESOLVED", currentCard(state), () => { state.eventStep = "MOVEMENT_PREP"; })); return true; }
    const terrains = Object.values(state.terrain).filter((terrain) => terrainDefinition(terrain.instanceId).spawnColor === activation.terrainColor).sort((a, b) => a.positionIndex - b.positionIndex || a.side.localeCompare(b.side)).map((terrain) => terrain.instanceId);
    const base = activation.severity === "MAJOR" ? SOLO_SETUP.majorSpawn : SOLO_SETUP.minorSpawn;
    const available = (["LEFT", "RIGHT"] as const).reduce((sum, side) => {
      const demand = terrains.filter((id) => state.terrain[id].side === side).length * base;
      return sum + Math.min(demand, state.orderedSources[side === "LEFT" ? "blip.left" : "blip.right"].length);
    }, 0);
    if (terrains.length > 1 && available < terrains.length * base) {
      const orders = permutations(terrains);
      request(state, makeDecision(state, "EVENT_SPAWN_PRIORITY", currentCard(state), "event.spawnPriority", orders.map((ids, index) => ({ id: `order:${index}`, label: ids.map((id) => `${terrainDefinition(id).name} F${state.terrain[id].positionIndex + 1} ${state.terrain[id].side}`).join(" → "), payload: { order: ids.join(","), spawnPerTerrain: base }, canonicalEffectPreview: null }))), transitions); return false;
    }
    transitions.push(commitTransition(state, "EVENT_ACTIVATION_STARTED", currentCard(state), () => { runtime.data.spawnPerTerrain = base; runtime.spawnTerrainIds = terrains; state.eventStep = "ACTIVATION_SPAWN"; })); return true;
  }
  if (state.eventStep === "ACTIVATION_SPAWN") {
    const terrainId = runtime.spawnTerrainIds[0];
    if (!terrainId) { transitions.push(commitTransition(state, "EVENT_ACTIVATION_RESOLVED", currentCard(state), () => { runtime.activationIndex += 1; state.eventStep = "ACTIVATION_PREP"; })); return true; }
    const terrain = state.terrain[terrainId]; const side = terrain.side; const source = side === "LEFT" ? "blip.left" : "blip.right"; const key = `spawned.${runtime.activationIndex}.${terrainId}`;
    const coreCap = state.roundEffects.find((effect) => effect.data.handlerId === "location.core-cogitator" && effect.targetIds.includes(terrainId));
    const target = Math.min(Number(runtime.data.spawnPerTerrain), Number(coreCap?.data.maximumSpawn ?? 99));
    if (Number(runtime.data[key] ?? 0) >= target || !state.orderedSources[source].length) { transitions.push(commitTransition(state, "EVENT_TERRAIN_SPAWN_RESOLVED", terrainId, () => { runtime.spawnTerrainIds.shift(); })); return true; }
    drawGenestealer(state, side, terrain.positionIndex, side, transitions, () => { runtime.data[key] = Number(runtime.data[key] ?? 0) + 1; }); return true;
  }
  if (state.eventStep === "MOVEMENT_PREP") {
    const event = eventDefinition(currentCard(state)); const queue = event.movementIcon ? Object.values(state.swarms).filter((swarm) => swarmActivates(state, swarm, event.movementIcon!)).sort((a, b) => a.positionIndex - b.positionIndex || a.side.localeCompare(b.side) || a.id.localeCompare(b.id)).map((swarm) => swarm.id) : [];
    transitions.push(commitTransition(state, "EVENT_MOVEMENT_STARTED", currentCard(state), () => { runtime.movementQueue = queue; state.eventStep = "MOVEMENT"; })); return true;
  }
  if (state.eventStep === "MOVEMENT") {
    const swarmId = runtime.movementQueue[0]; if (!swarmId) { transitions.push(commitTransition(state, "EVENT_MOVEMENT_RESOLVED", currentCard(state), () => { state.eventStep = "END_EFFECTS"; })); return true; }
    const swarm = state.swarms[swarmId];
    if (!swarm) { transitions.push(commitTransition(state, "EVENT_MOVEMENT_TARGET_GONE", currentCard(state), () => { runtime.movementQueue.shift(); })); return true; }
    const cards = [...swarm.cardIds, ...swarm.broodLordIds];
    if (cards.some((id) => runtime.movedCardIds.includes(id))) { transitions.push(commitTransition(state, "EVENT_MOVEMENT_ALREADY_RESOLVED", currentCard(state), () => { runtime.movementQueue.shift(); })); return true; }
    const movement = eventDefinition(currentCard(state)).movement; const marineId = state.formation[swarm.positionIndex].marineInstanceId;
    transitions.push(commitTransition(state, movement === "FLANK" ? "SWARM_FLANKED" : "SWARM_MOVED", currentCard(state), () => {
      runtime.movementQueue.shift();
      if (movement === "FLANK") moveSwarm(state, swarmId, swarm.positionIndex, opposite(state.marines[marineId].facing));
      else { const next = swarm.positionIndex + (swarm.side === "LEFT" ? 1 : -1); if (next < 0 || next >= state.formation.length) moveSwarm(state, swarmId, swarm.positionIndex, opposite(state.marines[marineId].facing)); else moveSwarm(state, swarmId, next, swarm.side); }
      runtime.movedCardIds.push(...cards); for (const id of cards) if (state.genestealers[id]) state.genestealers[id].movedOrFlankedThisEvent = true;
    })); return true;
  }
  if (state.eventStep === "END_EFFECTS") {
    const overwatch = state.roundEffects.find((effect) => effect.data.handlerId === "action.overwatch" && Number(effect.data.activeRound ?? state.round) === state.round);
    if (overwatch && runtime.data.overwatchResolved !== true) {
      const ids = overwatch.targetIds.filter((id) => state.marines[id] && !runtime.processedMarineIds.includes(id)); const choice = eventAttackDecision(state, "overwatch", ids, true);
      if (choice) { request(state, choice, transitions); return false; }
    }
    transitions.push(commitTransition(state, "EVENT_END_EFFECTS_RESOLVED", currentCard(state), () => { if (overwatch) runtime.data.overwatchResolved = true; mergeAll(state); state.eventStep = "TRAVEL_CHECK"; })); return true;
  }
  if (state.eventStep === "TRAVEL_CHECK") {
    transitions.push(commitTransition(state, "EVENT_CARD_DISCARDED", currentCard(state), () => { const id = currentCard(state); state.orderedSources["event.discard"].push(id); state.components[id].zone = "DISCARD"; state.components[id].containerId = "event.discard"; state.eventStep = travelRequired(state) ? "TRAVEL" : "CLEANUP"; })); return true;
  }
  if (state.eventStep === "TRAVEL") { transitions.push(commitTransition(state, "TRAVEL_STARTED", state.currentLocationInstanceId, () => { state.travelRuntime = { returnPhase: "EVENT", doorRemaining: totalDoorSupport(state), arrivalRemaining: 0, activatingMarineId: null, data: {} }; state.travelStep = "DOOR"; state.eventStep = "CLEANUP"; })); return true; }
  if (state.eventStep === "CLEANUP") { transitions.push(commitTransition(state, "ROUND_ENDED", "EVENT", () => { endRound(state); })); return true; }
  throw new Error(`Unknown Event step: ${state.eventStep}`);
}

export function enterFormationDecision(state: GameState, actionId: string): PendingDecision | null {
  const effect = state.roundEffects.find((item) => item.data.handlerId === "event.enter-formation" && Number(item.data.activeRound) === state.round);
  if (!effect || effect.data[`used.${actionId}`] === true || state.supportSupply < 1 || actionDefinition(actionId).type !== "MOVE_ACTIVATE") return null;
  return makeDecision(state, "ENTER_FORMATION_SUPPORT", actionId, "event.enterFormation", [{ id: "skip", label: "Do not place Support", payload: { skip: true, actionId }, canonicalEffectPreview: null }, ...state.formation.map((slot, index) => ({ id: `marine:${slot.marineInstanceId}`, label: `F${index + 1} · ${marineName(state, slot.marineInstanceId)}`, payload: { skip: false, actionId, marineId: slot.marineInstanceId }, canonicalEffectPreview: "Place 1 Support" }))]);
}
