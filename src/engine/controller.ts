import type { TeamColor } from "@/src/data/types";
import { drawCard } from "./cards/draw-card";
import { Sha256CounterRng } from "./rng/sha256-counter";
import {
  attackMarineDecision,
  attackRerollDecision,
  attackSlayDecision,
  attackTargetDecision,
  eligibleSlainCards,
  heroicChargeSwarms,
  leadByExampleDecision,
  mechanicallyDistinctSlainCards,
  runAndGunDecision,
  slayGenestealer,
  slayMarine,
} from "./combat/attack";
import {
  broodLordCount,
  buildGenestealerAttackQueue,
  counterAttackSlayDecision,
  defendingMarineId,
  defenseRerollDecision,
  hasRoundAbility,
  swarmCannotAttack,
  swarmSize,
  travelRequired,
} from "./combat/defense";
import { actionDefinition } from "./actions/catalog";
import { terrainDefinition } from "./actions/catalog";
import {
  activationDecision,
  applyMarineSwap,
  facingDecision,
  movementDecision,
  onwardBrothersDecision,
} from "./actions/move-activate";
import {
  forwardScoutingDecision,
  intimidationDestinationDecision,
  intimidationEligibleCards,
  intimidationPickDecision,
  intimidationRollDecision,
  removeCardsFromSwarms,
  smallestBlipSide,
  stealthFirstDecision,
  stealthSecondDecision,
} from "./actions/move-specials";
import {
  applyPowerField,
  applyStrategizeMove,
  makeDecision,
  mergeStrategizeDestination,
  powerFieldDecision,
  registerSupportAbility,
  strategizeDecision,
  supportPlacementDecision,
} from "./actions/support";
import { createNewGame, type NewGameConfig } from "./setup/new-game";
import type { GameState, PendingDecision, PendingCheckpoint } from "./state/game-state";
import { commitTransition } from "./transitions/commit";
import type { DecisionRecord, EngineResult, TransitionRecord } from "./transitions/types";
import { assertStateInvariants } from "./validation/invariants";
import {
  allGenestealerSlayDecision,
  apothecarionFacingDecision,
  artefactPlacementDecision,
  arrivalMarineDecision,
  computeBlipTargets,
  controlPanelBlipDecision,
  discardBlips,
  discardOldTerrain,
  doorTravelDecision,
  genericFinalVictory,
  launchControlDecision,
  moveSwarmsToRedTerrain,
  nextRefillSide,
  placeArtefact,
  placeLocationTerrain,
  replaceTerrainDefinition,
  spawnBroodLordsAtRedTerrain,
  swarmChoiceDecision,
  teleportariumDecision,
  terrainChoiceDecision,
  totalDoorSupport,
  addGenestealerToSwarm,
} from "./travel/location";
import { locationDefinition } from "./actions/catalog";
import { advanceEvent, applyEventDecision, enterFormationDecision, handlesEventDecision } from "./event/event";

export { type NewGameConfig };

export function newGame(config: NewGameConfig): EngineResult {
  const setup = createNewGame(config);
  const advanced = advanceAutomatic(setup.state);
  return { state: advanced.state, transitions: [...setup.transitions, ...advanced.transitions], pendingDecision: advanced.pendingDecision };
}

export function advanceAutomatic(input: GameState): EngineResult {
  const state = structuredClone(input);
  const transitions: TransitionRecord[] = [];
  advanceMutable(state, transitions);
  assertStateInvariants(state);
  return { state, transitions, pendingDecision: state.pendingDecision };
}

export function submitDecision(input: GameState, decisionId: string, optionId: string): EngineResult {
  const state = structuredClone(input);
  const pending = state.pendingDecision;
  if (!pending || pending.id !== decisionId) throw new TypeError(`Stale or unknown decision: ${decisionId}`);
  const option = pending.legalOptions.find((candidate) => candidate.id === optionId);
  if (!option) throw new TypeError(`Illegal option ${optionId} for ${decisionId}`);
  const transitions: TransitionRecord[] = [];
  const decisionRecord: DecisionRecord = { decisionId, optionId, transitionSeq: state.transitionSeq + 1 };

  if (handlesEventDecision(pending.type)) {
    transitions.push(applyEventDecision(state, pending, option, decisionRecord));
  } else if (pending.type === "CHOOSE_ACTION") {
    const team = option.payload.team as TeamColor;
    const actionId = option.payload.actionId as string;
    transitions.push(commitTransition(state, "ACTION_SELECTED", actionId, () => {
      clearPendingDecision(state, pending);
      state.teams[team].chosenActionInstanceId = actionId;
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "PLACE_SUPPORT") {
    const marineId = option.payload.marineId as string;
    transitions.push(commitTransition(state, "SUPPORT_PLACED", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      state.supportSupply -= 1;
      state.marines[marineId].support += 1;
      state.actionStep = "SPECIAL";
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "STRATEGIZE") {
    transitions.push(commitTransition(state, option.payload.skip ? "ACTION_OPTION_SKIPPED" : "SWARM_MOVED", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      if (option.payload.skip) state.actionStep = "COMPLETE";
      else {
        const swarmId = option.payload.swarmId as string;
        applyStrategizeMove(state, swarmId, option.payload.positionIndex as number, option.payload.side as "LEFT" | "RIGHT");
        state.actionStep = `MERGE_STRATEGIZE:${swarmId}`;
      }
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "POWER_FIELD") {
    transitions.push(commitTransition(state, option.payload.skip ? "ACTION_OPTION_SKIPPED" : "POWER_FIELD_DEPLOYED", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      if (!option.payload.skip) applyPowerField(state, pending.sourceId, option.payload.swarmId as string);
      state.actionStep = "COMPLETE";
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "MOVE_MARINE") {
    transitions.push(commitTransition(state, option.payload.finish ? "MOVEMENT_FINISHED" : "MARINE_MOVED", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      if (option.payload.finish) state.actionStep = "FACING";
      else applyMarineSwap(state, option.payload.marineId as string, option.payload.to as number);
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "SET_FACING") {
    const marineId = option.payload.marineId as string;
    transitions.push(commitTransition(state, "MARINE_FACED", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      state.marines[marineId].facing = option.payload.facing as "LEFT" | "RIGHT";
      state.actionRuntime!.facingResolvedMarineIds.push(marineId);
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "ACTIVATE_TERRAIN") {
    const marineId = option.payload.marineId as string;
    const terrainId = option.payload.terrainId as string | undefined;
    transitions.push(commitTransition(state, option.payload.skip ? "TERRAIN_ACTIVATION_SKIPPED" : "TERRAIN_ACTIVATED", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      state.actionRuntime!.activationResolvedMarineIds.push(marineId);
      if (terrainId) {
        const terrain = state.terrain[terrainId];
        terrain.activatedThisRound = true;
        const handlerId = terrainDefinition(terrainId).handlerId;
        if (handlerId === "terrain.door") {
          if (state.supportSupply > 0) {
            state.supportSupply -= 1;
            terrain.support += 1;
          }
          const action = actionDefinition(pending.sourceId);
          state.actionStep = action.handlerId === "action.onward-brothers" && state.supportSupply > 0 ? `ONWARD_BROTHERS:${terrainId}` : "ACTIVATE";
        } else if (handlerId === "terrain.artefact") {
          removeTerrainFromFormation(state, terrainId);
          state.components[terrainId].zone = "PLAYER_POSSESSION";
          state.components[terrainId].containerId = `team.${actionDefinition(pending.sourceId).team.toLowerCase()}`;
        } else if (handlerId === "terrain.control-panel") {
          state.actionRuntime!.data.controlPanelTerrainId = terrainId;
          state.actionRuntime!.data.controlPanelMarineId = marineId;
          state.actionStep = "CONTROL_PANEL";
        } else if (handlerId !== "terrain.passive") {
          state.actionStep = `TERRAIN_HANDLER:${terrainId}:${marineId}`;
        }
      }
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "ONWARD_BROTHERS") {
    const terrainId = option.payload.terrainId as string;
    transitions.push(commitTransition(state, option.payload.place ? "TERRAIN_SUPPORT_CHANGED" : "ACTION_OPTION_SKIPPED", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      if (option.payload.place) {
        state.supportSupply -= 1;
        state.terrain[terrainId].support += 1;
      }
      state.actionStep = "ACTIVATE";
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "STEALTH_FIRST") {
    transitions.push(commitTransition(state, option.payload.skip ? "ACTION_OPTION_SKIPPED" : "BLIP_DISCARD_CHOSEN", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      state.actionStep = option.payload.skip ? "COMPLETE" : `STEALTH_DRAW_FIRST:${option.payload.side}`;
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "STEALTH_SECOND") {
    transitions.push(commitTransition(state, option.payload.skip ? "ACTION_OPTION_SKIPPED" : "SUPPORT_SPENT", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      if (option.payload.skip) state.actionStep = "COMPLETE";
      else {
        const marineId = option.payload.marineId as string;
        state.marines[marineId].support -= 1;
        state.supportSupply += 1;
        state.actionStep = `STEALTH_DRAW_SECOND:${option.payload.side}`;
      }
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "FORWARD_SCOUTING_ORDER") {
    const eventCardId = option.payload.eventCardId as string;
    transitions.push(commitTransition(state, "EVENT_REORDERED", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      if (option.payload.placement === "TOP") state.orderedSources["event.deck"].unshift(eventCardId);
      else state.orderedSources["event.deck"].push(eventCardId);
      state.components[eventCardId].zone = "DECK";
      state.components[eventCardId].containerId = "event.deck";
      state.actionStep = "COMPLETE";
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "INTIMIDATION_ROLL") {
    transitions.push(commitTransition(state, option.payload.roll ? "INTIMIDATION_CHOSEN" : "ACTION_OPTION_SKIPPED", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      state.actionStep = option.payload.roll ? "INTIMIDATION_ROLL" : "COMPLETE";
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "INTIMIDATION_PICK") {
    transitions.push(commitTransition(state, "GENESTEALER_SELECTED", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      state.actionRuntime!.selectedCardIds.push(option.payload.cardId as string);
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "INTIMIDATION_DESTINATION") {
    transitions.push(commitTransition(state, "BLIP_DESTINATION_SELECTED", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      state.actionRuntime!.data.intimidationSide = option.payload.side as string;
      state.actionStep = "INTIMIDATION_APPLY";
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "RUN_AND_GUN_ATTACK") {
    const marineId = option.payload.marineId as string;
    transitions.push(commitTransition(state, option.payload.attack ? "SUPPORT_SPENT" : "ACTION_OPTION_SKIPPED", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      if (!option.payload.attack) {
        state.actionRuntime!.specialResolvedMarineIds.push(marineId);
        state.actionStep = "RUN_AND_GUN";
      } else {
        state.marines[marineId].support -= 1;
        state.supportSupply += 1;
        state.actionRuntime!.data.attackerId = marineId;
        state.actionRuntime!.data.targetSwarmId = option.payload.swarmId as string;
        state.actionStep = "RUN_AND_GUN_ROLL";
      }
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "ATTACK_MARINE") {
    transitions.push(commitTransition(state, option.payload.finish || option.payload.declineBonus ? "ATTACK_SEQUENCE_FINISHED" : "ATTACKER_SELECTED", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      if (option.payload.finish) state.actionStep = "COMPLETE";
      else if (option.payload.declineBonus) {
        state.actionRuntime!.data.psionicBonusAttacks = 0;
        state.actionStep = "ATTACK";
      } else {
        state.actionRuntime!.data.attackerId = option.payload.marineId as string;
        state.actionRuntime!.data.attackWasBonus = option.payload.bonus === true;
        state.actionStep = "ATTACK_TARGET";
      }
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "ATTACK_TARGET") {
    const marineId = option.payload.marineId as string;
    transitions.push(commitTransition(state, option.payload.heroicCharge ? "HEROIC_CHARGE_STARTED" : "ATTACK_TARGETED", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      markAttackStarted(state, marineId);
      if (option.payload.heroicCharge) {
        state.actionRuntime!.data.heroicRemaining = 3;
        state.actionStep = "HEROIC_CHARGE_SLAY";
      } else {
        state.actionRuntime!.data.targetSwarmId = option.payload.swarmId as string;
        state.actionStep = "ATTACK_ROLL";
      }
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "ATTACK_REROLL") {
    const marineId = option.payload.marineId as string;
    transitions.push(commitTransition(state, option.payload.reroll ? "SUPPORT_SPENT" : "DIE_RESULT_KEPT", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      if (option.payload.reroll) {
        state.marines[marineId].support -= 1;
        state.supportSupply += 1;
        state.actionStep = state.activeDie?.purpose === "RUN_AND_GUN_ATTACK" ? "RUN_AND_GUN_ROLL" : "ATTACK_ROLL";
      } else state.actionStep = state.activeDie?.purpose === "RUN_AND_GUN_ATTACK" ? "RUN_AND_GUN_RESOLVE" : "ATTACK_RESOLVE";
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "ATTACK_SLAY") {
    const marineId = state.actionRuntime!.data.attackerId as string;
    transitions.push(commitTransition(state, option.payload.stop ? "GENESTEALER_SLAYING_FINISHED" : "GENESTEALER_SLAIN", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      if (!option.payload.stop) slayGenestealer(state, option.payload.swarmId as string, option.payload.cardId as string);
      if (state.actionStep === "RUN_AND_GUN_RESOLVE") finishRunAndGunAttack(state, marineId);
      else if (state.actionStep === "HEROIC_CHARGE_SLAY") {
        if (!option.payload.stop) state.actionRuntime!.data.heroicRemaining = Number(state.actionRuntime!.data.heroicRemaining) - 1;
        if (option.payload.stop || Number(state.actionRuntime!.data.heroicRemaining) === 0) state.actionStep = "HEROIC_CHARGE_ROLL";
      } else {
        if (!option.payload.stop) {
          state.actionRuntime!.data.attackKillsRemaining = Number(state.actionRuntime!.data.attackKillsRemaining) - 1;
          state.actionRuntime!.data.attackSlainThisAttack = true;
        }
        if (option.payload.stop || Number(state.actionRuntime!.data.attackKillsRemaining) === 0) finishStandardAttack(state, actionDefinition(pending.sourceId).handlerId);
      }
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "LEAD_BY_EXAMPLE") {
    transitions.push(commitTransition(state, option.payload.skip ? "ACTION_OPTION_SKIPPED" : "SUPPORT_PLACED", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      if (!option.payload.skip) {
        state.supportSupply -= 1;
        state.marines[option.payload.marineId as string].support += 1;
      }
      state.actionRuntime!.data.leadByExampleUsed = true;
      state.actionStep = "ATTACK";
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "DEFENSE_REROLL") {
    const marineId = option.payload.marineId as string;
    transitions.push(commitTransition(state, option.payload.reroll ? "SUPPORT_SPENT" : "DIE_RESULT_KEPT", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      if (option.payload.reroll) {
        state.marines[marineId].support -= 1;
        state.supportSupply += 1;
        state.genestealerAttackRuntime!.rerolledWithSupport = true;
        state.genestealerAttackStep = "ROLL";
      } else state.genestealerAttackStep = "RESOLVE";
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "COUNTER_ATTACK_SLAY") {
    const swarmId = option.payload.swarmId as string;
    transitions.push(commitTransition(state, "GENESTEALER_SLAIN", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      slayGenestealer(state, swarmId, option.payload.cardId as string);
      finishCounterAttack(state, swarmId);
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "DOOR_TRAVEL_SLAY") {
    transitions.push(commitTransition(state, option.payload.stop ? "DOOR_ABILITY_FINISHED" : "GENESTEALER_SLAIN", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      if (option.payload.stop) state.travelRuntime!.doorRemaining = 0;
      else {
        slayGenestealer(state, option.payload.swarmId as string, option.payload.cardId as string);
        state.travelRuntime!.doorRemaining -= 1;
      }
      state.travelStep = "DOOR";
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "MUNITORIUM_SUPPORT") {
    const marineId = option.payload.marineId as string;
    transitions.push(commitTransition(state, "SUPPORT_PLACED", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      state.supportSupply -= 1;
      state.marines[marineId].support += 1;
      state.travelRuntime!.arrivalRemaining -= 1;
      state.travelRuntime!.data[`munitorium.${marineId}`] = true;
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "PLACE_ARTEFACT") {
    transitions.push(commitTransition(state, "TERRAIN_PLACED", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      placeArtefact(state, option.payload.positionIndex as number, option.payload.side as "LEFT" | "RIGHT");
      state.travelStep = "VICTORY_CHECK";
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "DARK_CATACOMBS_MARINE") {
    transitions.push(commitTransition(state, "LOCATION_TARGET_SELECTED", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      state.travelRuntime!.data.arrivalMarineId = option.payload.marineId as string;
      state.travelRuntime!.arrivalRemaining = 1;
      state.travelStep = "ARRIVAL_SPAWN";
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "BLACK_HOLDS_SWARM") {
    transitions.push(commitTransition(state, "LOCATION_TARGET_SELECTED", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      state.travelRuntime!.data.arrivalSwarmId = option.payload.swarmId as string;
      state.travelRuntime!.arrivalRemaining = 2;
      state.travelStep = "ARRIVAL_SPAWN";
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "CRYO_CONTROL_BLIP" || pending.type === "TOXIN_BLIP") {
    transitions.push(commitTransition(state, "BLIP_DESTINATION_SELECTED", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      state.actionRuntime!.data.controlPanelSide = option.payload.side as string;
      state.actionStep = pending.type === "CRYO_CONTROL_BLIP" ? "CONTROL_PANEL_DRAW" : "TOXIN_DRAW";
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "APOTHECARION_MARINE") {
    const marineId = option.payload.marineId as string;
    transitions.push(commitTransition(state, "SUPPORT_PLACED", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      state.supportSupply -= 1;
      state.marines[marineId].support += 1;
      state.actionRuntime!.data.controlPanelMarineId = marineId;
      state.actionStep = "APOTHECARION_FACING";
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "APOTHECARION_FACING") {
    transitions.push(commitTransition(state, "MARINE_FACED", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      state.marines[option.payload.marineId as string].facing = option.payload.facing as "LEFT" | "RIGHT";
      state.actionStep = "ACTIVATE";
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "TELEPORTARIUM_MARINE") {
    const marineId = option.payload.marineId as string;
    transitions.push(commitTransition(state, option.payload.spend ? "SUPPORT_SPENT" : "TELEPORTARIUM_ROLL_CHOSEN", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      if (option.payload.spend) {
        state.marines[marineId].support -= 1;
        state.supportSupply += 1;
        state.actionRuntime!.data[`teleportarium.${marineId}`] = true;
        state.actionStep = "CONTROL_PANEL";
      } else {
        state.actionRuntime!.data.controlPanelMarineId = marineId;
        state.actionStep = "TELEPORTARIUM_ROLL";
      }
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "CORE_COGITATOR_TERRAIN") {
    const terrainId = option.payload.terrainId as string;
    transitions.push(commitTransition(state, "LOCATION_EFFECT_REGISTERED", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      state.roundEffects.push({ id: `effect.round-${state.round}.core-cogitator.${terrainId}`, sourceId: state.currentLocationInstanceId, startTiming: "NEXT_EVENT", expiryTiming: "END_OF_EVENT", targetIds: [terrainId], mergePropagation: "NONE", data: { handlerId: "location.core-cogitator", maximumSpawn: 1 } });
      state.actionStep = "ACTIVATE";
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "LAUNCH_CONTROL") {
    transitions.push(commitTransition(state, option.payload.place ? "LOCATION_SUPPORT_CHANGED" : "LAUNCH_ROLL_CHOSEN", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      if (option.payload.place) {
        state.supportSupply -= 1;
        state.locationSupport[state.currentLocationInstanceId] = (state.locationSupport[state.currentLocationInstanceId] ?? 0) + 1;
        state.actionStep = "ACTIVATE";
      } else state.actionStep = "LAUNCH_CONTROL_ROLL";
    }, { playerDecision: decisionRecord }));
  } else if (pending.type === "GENETORIUM_SLAY") {
    transitions.push(commitTransition(state, option.payload.stop ? "GENESTEALER_SLAYING_FINISHED" : "GENESTEALER_SLAIN", pending.sourceId, () => {
      clearPendingDecision(state, pending);
      if (option.payload.stop) state.actionRuntime!.data.controlPanelRemaining = 0;
      else {
        slayGenestealer(state, option.payload.swarmId as string, option.payload.cardId as string);
        state.actionRuntime!.data.controlPanelRemaining = Number(state.actionRuntime!.data.controlPanelRemaining) - 1;
      }
      state.actionStep = "GENETORIUM_SLAY";
    }, { playerDecision: decisionRecord }));
  } else {
    throw new TypeError(`Unsupported decision type: ${pending.type}`);
  }

  advanceMutable(state, transitions);
  assertStateInvariants(state);
  return { state, transitions, pendingDecision: state.pendingDecision };
}

function advanceMutable(state: GameState, transitions: TransitionRecord[]): void {
  while (!state.pendingDecision && state.status === "IN_PROGRESS") {
    if (!state.travelRuntime && victorySatisfied(state)) {
      transitions.push(commitTransition(state, "GAME_WON", state.currentLocationInstanceId, () => {
        finishVictoryState(state);
      }));
      continue;
    }
    if (state.travelRuntime) {
      if (!advanceTravel(state, transitions)) return;
      if (!state.travelRuntime && state.phase === "EVENT" && !state.eventRuntime) return;
      continue;
    }
    if (state.phase === "CHOOSE_ACTIONS") {
      const nextTeam = state.activeTeams.find((color) => state.teams[color].active && state.teams[color].chosenActionInstanceId === null);
      if (nextTeam) {
        requestDecision(state, actionSelectionDecision(state, nextTeam), transitions);
        return;
      }
      lockActions(state, transitions);
      continue;
    }
    if (state.phase === "GENESTEALER_ATTACK") {
      if (!advanceGenestealerAttack(state, transitions)) return;
      continue;
    }
    if (state.phase === "EVENT") {
      if (!advanceEvent(state, transitions)) return;
      continue;
    }
    if (state.phase !== "RESOLVE_ACTIONS") return;
    if (state.currentActionIndex >= state.actionQueue.length) {
      if (travelRequired(state)) {
        transitions.push(beginTravelTransition(state, "GENESTEALER_ATTACK"));
        continue;
      }
      transitions.push(commitTransition(state, "PHASE_ENDED", "RESOLVE_ACTIONS", () => {
        state.phase = "GENESTEALER_ATTACK";
        state.actionQueue = [];
        state.currentActionIndex = 0;
        state.actionStep = null;
        state.pendingQueue.push({ id: `checkpoint.${state.transitionSeq + 1}.genestealer-attack`, sourceId: "GENESTEALER_ATTACK", timing: "PHASE_START", kind: "CHECK", mandatory: true, affectedIds: [], decisionId: null });
      }));
      return;
    }
    const actionId = state.actionQueue[state.currentActionIndex];
    const action = actionDefinition(actionId);
    if (state.actionStep === null) {
      const enterFormation = enterFormationDecision(state, actionId);
      if (enterFormation) {
        requestDecision(state, enterFormation, transitions);
        return;
      }
      transitions.push(commitTransition(state, "ACTION_STARTED", actionId, () => {
        state.components[actionId].zone = "RESOLVING";
        state.components[actionId].containerId = null;
        state.actionStep = action.type === "MOVE_ACTIVATE" ? "MOVE" : action.type === "ATTACK" ? "ATTACK" : "BASE";
        state.actionRuntime = { actionId, movedMarineIds: [], facingResolvedMarineIds: [], activationResolvedMarineIds: [], specialResolvedMarineIds: [], selectedCardIds: [], data: {} };
      }));
      continue;
    }
    if (action.type === "ATTACK" && state.actionStep !== "COMPLETE") {
      if (state.actionStep === "ATTACK") {
        const bonusAttacks = Number(state.actionRuntime!.data.psionicBonusAttacks ?? 0);
        const decision = attackMarineDecision(state, actionId);
        if (decision) { requestDecision(state, decision, transitions); return; }
        transitions.push(commitTransition(state, bonusAttacks > 0 ? "PSIONIC_ATTACK_UNAVAILABLE" : "ATTACK_SEQUENCE_FINISHED", actionId, () => {
          state.actionRuntime!.data.psionicBonusAttacks = 0;
          state.actionStep = bonusAttacks > 0 ? "ATTACK" : "COMPLETE";
        }));
        continue;
      }
      if (state.actionStep === "ATTACK_TARGET") {
        const marineId = state.actionRuntime!.data.attackerId as string;
        requestDecision(state, attackTargetDecision(state, actionId, marineId), transitions);
        return;
      }
      if (state.actionStep === "ATTACK_ROLL") {
        rollAttackDie(state, actionId, "ATTACK", transitions);
        continue;
      }
      if (state.actionStep === "ATTACK_REROLL") {
        const marineId = state.actionRuntime!.data.attackerId as string;
        const decision = attackRerollDecision(state, actionId, marineId);
        if (decision) { requestDecision(state, decision, transitions); return; }
        transitions.push(commitTransition(state, "DIE_RESULT_KEPT", actionId, () => { state.actionStep = "ATTACK_RESOLVE"; }));
        continue;
      }
      if (state.actionStep === "ATTACK_RESOLVE") {
        const marineId = state.actionRuntime!.data.attackerId as string;
        const swarmId = state.actionRuntime!.data.targetSwarmId as string;
        const handlerId = action.handlerId;
        const face = state.activeDie!;
        const desiredKills = handlerId === "action.flamer-attack" && marineId === "marine.purple.brother-zael"
          ? face.modifiedValue
          : handlerId === "action.dead-aim" && face.rawValue === 4
            ? 3
            : face.skull ? 1 : 0;
        const eligible = eligibleSlainCards(state, swarmId);
        const distinctEligible = mechanicallyDistinctSlainCards(state, swarmId);
        const count = Math.min(desiredKills, eligible.length);
        if (count === 0) {
          transitions.push(commitTransition(state, "ATTACK_MISSED", actionId, () => { finishStandardAttack(state, handlerId); }));
          continue;
        }
        if (count === 1 && distinctEligible.length === 1) {
          transitions.push(commitTransition(state, "GENESTEALER_SLAIN", actionId, () => {
            slayGenestealer(state, swarmId, distinctEligible[0]);
            state.actionRuntime!.data.attackSlainThisAttack = true;
            finishStandardAttack(state, handlerId);
          }));
          continue;
        }
        transitions.push(commitTransition(state, "ATTACK_SLAY_COUNT_DETERMINED", actionId, () => {
          state.actionRuntime!.data.attackKillsRemaining = count;
          state.actionStep = "ATTACK_SLAY";
        }));
        continue;
      }
      if (state.actionStep === "ATTACK_SLAY") {
        const swarmId = state.actionRuntime!.data.targetSwarmId as string;
        const remaining = Number(state.actionRuntime!.data.attackKillsRemaining);
        const decision = remaining > 0 ? attackSlayDecision(state, actionId, [swarmId], action.handlerId === "action.dead-aim") : null;
        if (decision) { requestDecision(state, decision, transitions); return; }
        transitions.push(commitTransition(state, "GENESTEALER_SLAYING_FINISHED", actionId, () => { finishStandardAttack(state, action.handlerId); }));
        continue;
      }
      if (state.actionStep === "HEROIC_CHARGE_SLAY") {
        const marineId = state.actionRuntime!.data.attackerId as string;
        const swarmIds = heroicChargeSwarms(state, marineId);
        const remaining = Number(state.actionRuntime!.data.heroicRemaining);
        if (remaining === 0 || swarmIds.length === 0) {
          transitions.push(commitTransition(state, "HEROIC_CHARGE_SLAYING_FINISHED", actionId, () => { state.actionStep = "HEROIC_CHARGE_ROLL"; }));
          continue;
        }
        requestDecision(state, attackSlayDecision(state, actionId, swarmIds, true)!, transitions);
        return;
      }
      if (state.actionStep === "HEROIC_CHARGE_ROLL") {
        const rng = Sha256CounterRng.restore(state.rng);
        const face = rng.rollCombatDie();
        const resultingRng = rng.snapshot();
        transitions.push(commitTransition(state, "DIE_ROLLED", actionId, () => {
          state.rng = resultingRng;
          state.activeDie = { id: `die.${state.transitionSeq + 1}`, sourceId: actionId, purpose: "HEROIC_CHARGE", rawValue: face.value, skull: face.skull, modifiedValue: face.value, rerolls: [] };
          state.actionStep = "HEROIC_CHARGE_RESOLVE";
        }, { randomInputs: [{ operationSeq: resultingRng.operationSeq, kind: "DIE", sourceId: actionId, cardId: null, preLength: null, postLength: null, resultingRng }] }));
        continue;
      }
      if (state.actionStep === "HEROIC_CHARGE_RESOLVE") {
        const marineId = state.actionRuntime!.data.attackerId as string;
        transitions.push(commitTransition(state, state.activeDie!.rawValue === 0 ? "MARINE_SLAIN" : "HEROIC_CHARGE_SURVIVED", actionId, () => {
          if (state.activeDie!.rawValue === 0) slayMarine(state, marineId);
          finishStandardAttack(state, action.handlerId);
        }));
        continue;
      }
      if (state.actionStep === "LEAD_BY_EXAMPLE") {
        requestDecision(state, leadByExampleDecision(state, actionId), transitions);
        return;
      }
      throw new Error(`Unknown Attack action step: ${state.actionStep}`);
    }
    if (action.type === "MOVE_ACTIVATE") {
      if (state.actionStep === "MOVE") {
        const decision = movementDecision(state, actionId);
        if (decision && decision.legalOptions.length > 1) { requestDecision(state, decision, transitions); return; }
        transitions.push(commitTransition(state, "MOVEMENT_FINISHED", actionId, () => { state.actionStep = "FACING"; }));
        continue;
      }
      if (state.actionStep === "FACING") {
        const decision = facingDecision(state, actionId);
        if (decision) { requestDecision(state, decision, transitions); return; }
        transitions.push(commitTransition(state, "FACING_FINISHED", actionId, () => { state.actionStep = "ACTIVATE"; }));
        continue;
      }
      if (state.actionStep === "ACTIVATE") {
        const decision = activationDecision(state, actionId);
        if (decision) {
          if (decision.legalOptions.length > 1) { requestDecision(state, decision, transitions); return; }
          const marineId = decision.legalOptions[0].payload.marineId as string;
          transitions.push(commitTransition(state, "TERRAIN_ACTIVATION_UNAVAILABLE", actionId, () => { state.actionRuntime!.activationResolvedMarineIds.push(marineId); }));
          continue;
        }
        transitions.push(commitTransition(state, "ACTIVATION_FINISHED", actionId, () => { state.actionStep = "SPECIAL"; }));
        continue;
      }
      if (state.actionStep.startsWith("ONWARD_BROTHERS:")) {
        requestDecision(state, onwardBrothersDecision(state, actionId, state.actionStep.split(":", 2)[1]), transitions);
        return;
      }
      if (state.actionStep === "CONTROL_PANEL"
        || state.actionStep === "CONTROL_PANEL_DRAW"
        || state.actionStep === "APOTHECARION_FACING"
        || state.actionStep === "TELEPORTARIUM_ROLL"
        || state.actionStep === "TELEPORTARIUM_RESOLVE"
        || state.actionStep === "GENETORIUM_ROLL"
        || state.actionStep === "GENETORIUM_RESOLVE"
        || state.actionStep === "GENETORIUM_SLAY"
        || state.actionStep === "LAUNCH_CONTROL_ROLL"
        || state.actionStep === "LAUNCH_CONTROL_RESOLVE"
        || state.actionStep === "TOXIN_ROLL"
        || state.actionStep === "TOXIN_RESOLVE"
        || state.actionStep === "TOXIN_DISCARD"
        || state.actionStep === "TOXIN_DRAW") {
        if (!advanceControlPanel(state, transitions)) return;
        continue;
      }
      if (state.actionStep.startsWith("TERRAIN_HANDLER:")) {
        const [, terrainId, marineId] = state.actionStep.split(":", 3);
        if (terrainDefinition(terrainId).handlerId === "terrain.promethium-tank") {
          const positionIndex = state.terrain[terrainId].positionIndex;
          transitions.push(commitTransition(state, "PROMETHIUM_TANK_DETONATED", terrainId, () => {
            removeTerrainFromFormation(state, terrainId);
            state.components[terrainId].zone = "DISCARD";
            state.components[terrainId].containerId = null;
            for (const swarm of Object.values(state.swarms).filter((item) => item.positionIndex === positionIndex)) {
              let eligible = eligibleSlainCards(state, swarm.id);
              while (eligible.length) {
                slayGenestealer(state, swarm.id, eligible[0]);
                eligible = eligibleSlainCards(state, swarm.id);
              }
            }
            state.actionRuntime!.data.terrainMarineId = marineId;
            state.actionStep = "PROMETHIUM_ROLL";
          }));
          continue;
        }
        if (terrainDefinition(terrainId).handlerId === "terrain.spore-chimney") {
          const rng = Sha256CounterRng.restore(state.rng);
          const face = rng.rollCombatDie();
          const resultingRng = rng.snapshot();
          transitions.push(commitTransition(state, "DIE_ROLLED", terrainId, () => {
            state.rng = resultingRng;
            state.activeDie = { id: `die.${state.transitionSeq + 1}`, sourceId: terrainId, purpose: "SPORE_CHIMNEY", rawValue: face.value, skull: face.skull, modifiedValue: face.value, rerolls: [] };
            state.actionRuntime!.data.terrainMarineId = marineId;
            state.actionRuntime!.data.terrainId = terrainId;
            state.actionStep = "SPORE_CHIMNEY_RESOLVE";
          }, { randomInputs: [{ operationSeq: resultingRng.operationSeq, kind: "DIE", sourceId: terrainId, cardId: null, preLength: null, postLength: null, resultingRng }] }));
          continue;
        }
        if (!state.pendingQueue.some((checkpoint) => checkpoint.timing === "IMPLEMENTATION_PENDING")) {
          transitions.push(commitTransition(state, "TERRAIN_HANDLER_PENDING", actionId, () => {
            state.pendingQueue.push({ id: `checkpoint.${state.transitionSeq + 1}.terrain-handler`, sourceId: state.actionStep!, timing: "IMPLEMENTATION_PENDING", kind: "CHECK", mandatory: true, affectedIds: [state.actionStep!], decisionId: null });
          }));
        }
        return;
      }
      if (state.actionStep === "SPORE_CHIMNEY_RESOLVE") {
        const terrainId = state.actionRuntime!.data.terrainId as string;
        transitions.push(commitTransition(state, state.activeDie!.skull ? "TERRAIN_DISCARDED" : "TERRAIN_EFFECT_RESOLVED", terrainId, () => {
          if (state.activeDie!.skull) {
            removeTerrainFromFormation(state, terrainId);
            state.components[terrainId].zone = "DISCARD";
            state.components[terrainId].containerId = null;
          }
          state.activeDie = null;
          state.actionStep = "ACTIVATE";
        }));
        continue;
      }
      if (state.actionStep === "PROMETHIUM_ROLL") {
        const rng = Sha256CounterRng.restore(state.rng);
        const face = rng.rollCombatDie();
        const resultingRng = rng.snapshot();
        transitions.push(commitTransition(state, "DIE_ROLLED", "terrain.promethium-tank", () => {
          state.rng = resultingRng;
          state.activeDie = { id: `die.${state.transitionSeq + 1}`, sourceId: "terrain.promethium-tank", purpose: "PROMETHIUM_TANK", rawValue: face.value, skull: face.skull, modifiedValue: face.value, rerolls: [] };
          state.actionStep = "PROMETHIUM_RESOLVE";
        }, { randomInputs: [{ operationSeq: resultingRng.operationSeq, kind: "DIE", sourceId: "terrain.promethium-tank", cardId: null, preLength: null, postLength: null, resultingRng }] }));
        continue;
      }
      if (state.actionStep === "PROMETHIUM_RESOLVE") {
        const marineId = state.actionRuntime!.data.terrainMarineId as string;
        transitions.push(commitTransition(state, state.activeDie!.rawValue === 0 ? "MARINE_SLAIN" : "TERRAIN_EFFECT_RESOLVED", "terrain.promethium-tank", () => {
          if (state.activeDie!.rawValue === 0 && state.marines[marineId]) slayMarine(state, marineId);
          state.activeDie = null;
          state.actionStep = "ACTIVATE";
        }));
        continue;
      }
      if (state.actionStep === "SPECIAL") {
        if (["action.onward-brothers", "action.reorganize"].includes(action.handlerId)) {
          transitions.push(commitTransition(state, "ACTION_SPECIAL_COMPLETED", actionId, () => { state.actionStep = "COMPLETE"; }));
          continue;
        }
        if (action.handlerId === "action.stealth-tactics") {
          const decision = stealthFirstDecision(state, actionId);
          if (decision) { requestDecision(state, decision, transitions); return; }
          transitions.push(commitTransition(state, "ACTION_OPTION_SKIPPED", actionId, () => { state.actionStep = "COMPLETE"; }));
          continue;
        }
        if (action.handlerId === "action.forward-scouting") {
          const rng = Sha256CounterRng.restore(state.rng);
          const result = drawCard(state, rng, "event.deck", { zone: "RESOLVING", containerId: null }, (cardId) => {
            state.actionRuntime!.data.scoutedEventCardId = cardId;
            state.actionStep = "FORWARD_SCOUTING_ORDER";
          });
          transitions.push(...result.transitions);
          continue;
        }
        if (action.handlerId === "action.intimidation") {
          requestDecision(state, intimidationRollDecision(state, actionId), transitions);
          return;
        }
        if (action.handlerId === "action.run-and-gun") {
          transitions.push(commitTransition(state, "RUN_AND_GUN_STARTED", actionId, () => { state.actionStep = "RUN_AND_GUN"; }));
          continue;
        }
        else {
          if (!state.pendingQueue.some((checkpoint) => checkpoint.timing === "IMPLEMENTATION_PENDING")) {
            transitions.push(commitTransition(state, "ACTION_HANDLER_PENDING", actionId, () => {
              state.pendingQueue.push({ id: `checkpoint.${state.transitionSeq + 1}.move-special`, sourceId: actionId, timing: "IMPLEMENTATION_PENDING", kind: "CHECK", mandatory: true, affectedIds: [actionId], decisionId: null });
            }));
          }
          return;
        }
      }
      if (state.actionStep.startsWith("STEALTH_DRAW_FIRST:")) {
        const side = state.actionStep.split(":", 2)[1] as "LEFT" | "RIGHT";
        const source = side === "LEFT" ? "blip.left" : "blip.right";
        const other = side === "LEFT" ? "RIGHT" : "LEFT";
        const rng = Sha256CounterRng.restore(state.rng);
        const result = drawCard(state, rng, source, { zone: "DISCARD", containerId: "genestealer.discard" }, (cardId) => {
          state.orderedSources["genestealer.discard"].push(cardId);
          state.actionRuntime!.data.stealthOtherSide = other;
          state.actionStep = "STEALTH_SECOND";
        });
        transitions.push(...result.transitions);
        continue;
      }
      if (state.actionStep === "STEALTH_SECOND") {
        const side = state.actionRuntime!.data.stealthOtherSide as "LEFT" | "RIGHT";
        const decision = stealthSecondDecision(state, actionId, side);
        if (decision) { requestDecision(state, decision, transitions); return; }
        transitions.push(commitTransition(state, "ACTION_OPTION_SKIPPED", actionId, () => { state.actionStep = "COMPLETE"; }));
        continue;
      }
      if (state.actionStep.startsWith("STEALTH_DRAW_SECOND:")) {
        const side = state.actionStep.split(":", 2)[1] as "LEFT" | "RIGHT";
        const source = side === "LEFT" ? "blip.left" : "blip.right";
        const rng = Sha256CounterRng.restore(state.rng);
        const result = drawCard(state, rng, source, { zone: "DISCARD", containerId: "genestealer.discard" }, (cardId) => {
          state.orderedSources["genestealer.discard"].push(cardId);
          state.actionStep = "COMPLETE";
        });
        transitions.push(...result.transitions);
        continue;
      }
      if (state.actionStep === "FORWARD_SCOUTING_ORDER") {
        requestDecision(state, forwardScoutingDecision(state, actionId, state.actionRuntime!.data.scoutedEventCardId as string), transitions);
        return;
      }
      if (state.actionStep === "INTIMIDATION_ROLL") {
        const rng = Sha256CounterRng.restore(state.rng);
        const face = rng.rollCombatDie();
        const resultingRng = rng.snapshot();
        const eligibleCount = intimidationEligibleCards(state).length;
        transitions.push(commitTransition(state, "DIE_ROLLED", actionId, () => {
          state.rng = resultingRng;
          state.activeDie = { id: `die.${state.transitionSeq + 1}`, sourceId: actionId, purpose: "INTIMIDATION", rawValue: face.value, skull: face.skull, modifiedValue: face.value, rerolls: [] };
          state.actionRuntime!.data.intimidationCount = Math.min(face.value, eligibleCount);
          state.actionStep = Math.min(face.value, eligibleCount) === 0 ? "COMPLETE" : "INTIMIDATION_PICK";
        }, { randomInputs: [{ operationSeq: resultingRng.operationSeq, kind: "DIE", sourceId: actionId, cardId: null, preLength: null, postLength: null, resultingRng }] }));
        continue;
      }
      if (state.actionStep === "INTIMIDATION_PICK") {
        const decision = intimidationPickDecision(state, actionId);
        if (decision) { requestDecision(state, decision, transitions); return; }
        const side = smallestBlipSide(state);
        if (side) {
          transitions.push(commitTransition(state, "BLIP_DESTINATION_DETERMINED", actionId, () => {
            state.actionRuntime!.data.intimidationSide = side;
            state.actionStep = "INTIMIDATION_APPLY";
          }));
          continue;
        }
        requestDecision(state, intimidationDestinationDecision(state, actionId)!, transitions);
        return;
      }
      if (state.actionStep === "INTIMIDATION_APPLY") {
        const side = state.actionRuntime!.data.intimidationSide as "LEFT" | "RIGHT";
        const source = side === "LEFT" ? "blip.left" : "blip.right";
        const selected = [...state.actionRuntime!.selectedCardIds];
        const rng = Sha256CounterRng.restore(state.rng);
        const shuffled = rng.shuffle([...state.orderedSources[source], ...selected]);
        const resultingRng = rng.snapshot();
        transitions.push(commitTransition(state, "GENESTEALERS_RETURNED_TO_BLIP", actionId, () => {
          removeCardsFromSwarms(state, selected);
          state.orderedSources[source] = shuffled;
          for (const cardId of selected) {
            state.components[cardId].zone = side === "LEFT" ? "LEFT_BLIP" : "RIGHT_BLIP";
            state.components[cardId].containerId = source;
          }
          state.rng = resultingRng;
          state.activeDie = null;
          state.actionStep = "COMPLETE";
        }, { randomInputs: [{ operationSeq: resultingRng.operationSeq, kind: "SHUFFLE", sourceId: source, cardId: null, preLength: shuffled.length - selected.length, postLength: shuffled.length, resultingRng }] }));
        continue;
      }
      if (state.actionStep === "RUN_AND_GUN") {
        const marineId = state.teams.GREEN.marineInstanceIds.find((id) => state.marines[id] && !state.actionRuntime!.specialResolvedMarineIds.includes(id));
        if (!marineId) {
          transitions.push(commitTransition(state, "RUN_AND_GUN_FINISHED", actionId, () => { state.actionStep = "COMPLETE"; }));
          continue;
        }
        const decision = runAndGunDecision(state, actionId, marineId);
        if (decision) { requestDecision(state, decision, transitions); return; }
        transitions.push(commitTransition(state, "RUN_AND_GUN_UNAVAILABLE", actionId, () => { state.actionRuntime!.specialResolvedMarineIds.push(marineId); }));
        continue;
      }
      if (state.actionStep === "RUN_AND_GUN_ROLL") {
        const rng = Sha256CounterRng.restore(state.rng);
        const face = rng.rollCombatDie();
        const resultingRng = rng.snapshot();
        const prior = state.activeDie;
        transitions.push(commitTransition(state, prior ? "DIE_REROLLED" : "DIE_ROLLED", actionId, () => {
          state.rng = resultingRng;
          state.activeDie = {
            id: prior?.id ?? `die.${state.transitionSeq + 1}`,
            sourceId: actionId,
            purpose: "RUN_AND_GUN_ATTACK",
            rawValue: face.value,
            skull: face.skull,
            modifiedValue: face.value,
            rerolls: prior ? [...prior.rerolls, { rawValue: prior.rawValue, skull: prior.skull, modifiedValue: prior.modifiedValue }] : [],
          };
          state.actionStep = "RUN_AND_GUN_REROLL";
        }, { randomInputs: [{ operationSeq: resultingRng.operationSeq, kind: "DIE", sourceId: actionId, cardId: null, preLength: null, postLength: null, resultingRng }] }));
        continue;
      }
      if (state.actionStep === "RUN_AND_GUN_REROLL") {
        const marineId = state.actionRuntime!.data.attackerId as string;
        const decision = attackRerollDecision(state, actionId, marineId);
        if (decision) { requestDecision(state, decision, transitions); return; }
        transitions.push(commitTransition(state, "DIE_RESULT_KEPT", actionId, () => { state.actionStep = "RUN_AND_GUN_RESOLVE"; }));
        continue;
      }
      if (state.actionStep === "RUN_AND_GUN_RESOLVE") {
        const marineId = state.actionRuntime!.data.attackerId as string;
        const swarmId = state.actionRuntime!.data.targetSwarmId as string;
        const eligible = state.activeDie?.skull ? eligibleSlainCards(state, swarmId) : [];
        if (eligible.length > 1) {
          requestDecision(state, attackSlayDecision(state, actionId, [swarmId])!, transitions);
          return;
        }
        transitions.push(commitTransition(state, eligible.length === 1 ? "GENESTEALER_SLAIN" : "ATTACK_MISSED", actionId, () => {
          if (eligible.length === 1) slayGenestealer(state, swarmId, eligible[0]);
          finishRunAndGunAttack(state, marineId);
        }));
        continue;
      }
    }
    if (state.actionStep === "BASE") {
      if (state.supportSupply === 0) {
        transitions.push(commitTransition(state, "SUPPORT_PLACEMENT_SKIPPED", actionId, () => { state.actionStep = "SPECIAL"; }));
        continue;
      }
      requestDecision(state, supportPlacementDecision(state, actionId), transitions);
      return;
    }
    if (state.actionStep === "SPECIAL") {
      if (action.handlerId === "action.strategize") {
        const decision = strategizeDecision(state, actionId);
        if (decision) { requestDecision(state, decision, transitions); return; }
        transitions.push(commitTransition(state, "ACTION_OPTION_SKIPPED", actionId, () => { state.actionStep = "COMPLETE"; }));
        continue;
      }
      if (action.handlerId === "action.power-field") {
        const decision = powerFieldDecision(state, actionId);
        if (decision) { requestDecision(state, decision, transitions); return; }
        transitions.push(commitTransition(state, "ACTION_OPTION_SKIPPED", actionId, () => { state.actionStep = "COMPLETE"; }));
        continue;
      }
      transitions.push(registerSupportAbility(state, actionId));
      continue;
    }
    if (state.actionStep.startsWith("MERGE_STRATEGIZE:")) {
      const movedSwarmId = state.actionStep.split(":", 2)[1];
      const mergedIds: string[] = [];
      transitions.push(commitTransition(state, "SWARMS_MERGED", actionId, () => {
        mergedIds.push(...mergeStrategizeDestination(state, movedSwarmId));
        state.actionStep = "COMPLETE";
      }, { mutations: [{ path: `swarms.${movedSwarmId}`, operation: "SET", value: mergedIds.length }] }));
      continue;
    }
    if (state.actionStep === "COMPLETE") {
      transitions.push(commitTransition(state, "ACTION_COMPLETED", actionId, () => {
        const team = action.team;
        state.components[actionId].zone = state.teams[team].active ? "TEAM_HAND" : "REMOVED";
        state.components[actionId].containerId = state.teams[team].active ? `team.${team.toLowerCase()}` : null;
        state.teams[team].previousActionInstanceId = actionId;
        state.teams[team].chosenActionInstanceId = null;
        state.currentActionIndex += 1;
        state.actionStep = null;
        state.actionRuntime = null;
        state.activeDie = null;
      }));
      continue;
    }
    throw new Error(`Unknown action step: ${state.actionStep}`);
  }
}

function removeTerrainFromFormation(state: GameState, terrainId: string): void {
  const terrain = state.terrain[terrainId];
  if (!terrain) return;
  const slot = state.formation[terrain.positionIndex];
  slot.terrainInstanceIds[terrain.side] = slot.terrainInstanceIds[terrain.side].filter((id) => id !== terrainId);
  delete state.terrain[terrainId];
}

function advanceControlPanel(state: GameState, transitions: TransitionRecord[]): boolean {
  const runtime = state.actionRuntime!;
  const handlerId = locationDefinition(state.currentLocationInstanceId).handlerId;
  if (state.actionStep === "CONTROL_PANEL") {
    if (handlerId === "location.maintenance-tunnels") {
      transitions.push(commitTransition(state, "TERRAIN_REPLACED", state.currentLocationInstanceId, () => {
        replaceTerrainDefinition(state, runtime.data.controlPanelTerrainId as string, "terrain.corridor");
        state.actionStep = "ACTIVATE";
      }));
      return true;
    }
    if (handlerId === "location.cryo-control") {
      const decision = controlPanelBlipDecision(state, "CRYO_CONTROL_BLIP", "location.cryoControl");
      if (decision) { requestDecision(state, decision, transitions); return false; }
      transitions.push(commitTransition(state, "LOCATION_EFFECT_RESOLVED", state.currentLocationInstanceId, () => { state.actionStep = "ACTIVATE"; }));
      return true;
    }
    if (handlerId === "location.apothecarion") {
      if (state.supportSupply === 0) {
        transitions.push(commitTransition(state, "SUPPORT_PLACEMENT_SKIPPED", state.currentLocationInstanceId, () => { state.actionStep = "ACTIVATE"; }));
        return true;
      }
      requestDecision(state, arrivalMarineDecision(state, "APOTHECARION_MARINE", "location.apothecarion")!, transitions);
      return false;
    }
    if (handlerId === "location.teleportarium") {
      const marineId = state.formation.map((slot) => slot.marineInstanceId).find((id) => runtime.data[`teleportarium.${id}`] !== true);
      if (!marineId) {
        transitions.push(commitTransition(state, "BLIPS_DISCARDED", state.currentLocationInstanceId, () => {
          discardBlips(state);
          state.actionStep = "ACTIVATE";
        }));
        return true;
      }
      requestDecision(state, teleportariumDecision(state, marineId), transitions);
      return false;
    }
    if (handlerId === "location.core-cogitator") {
      const decision = terrainChoiceDecision(state);
      if (decision) { requestDecision(state, decision, transitions); return false; }
      transitions.push(commitTransition(state, "LOCATION_EFFECT_RESOLVED", state.currentLocationInstanceId, () => { state.actionStep = "ACTIVATE"; }));
      return true;
    }
    if (handlerId === "location.genetorium") {
      transitions.push(commitTransition(state, "LOCATION_EFFECT_STARTED", state.currentLocationInstanceId, () => { state.actionStep = "GENETORIUM_ROLL"; }));
      return true;
    }
    if (handlerId === "location.launch-control-room") {
      requestDecision(state, launchControlDecision(state), transitions);
      return false;
    }
    if (handlerId === "location.toxin-pumping-station") {
      transitions.push(commitTransition(state, "LOCATION_EFFECT_STARTED", state.currentLocationInstanceId, () => { state.actionStep = "TOXIN_ROLL"; }));
      return true;
    }
    transitions.push(commitTransition(state, "LOCATION_EFFECT_RESOLVED", state.currentLocationInstanceId, () => { state.actionStep = "ACTIVATE"; }));
    return true;
  }
  if (state.actionStep === "CONTROL_PANEL_DRAW" || state.actionStep === "TOXIN_DRAW") {
    const side = runtime.data.controlPanelSide as "LEFT" | "RIGHT";
    const sourceId = side === "LEFT" ? "blip.left" : "blip.right";
    const rng = Sha256CounterRng.restore(state.rng);
    const result = drawCard(state, rng, sourceId, { zone: "DISCARD", containerId: "genestealer.discard" }, (cardId) => {
      state.orderedSources["genestealer.discard"].push(cardId);
      if (state.actionStep === "TOXIN_DRAW") {
        runtime.data.controlPanelRemaining = Number(runtime.data.controlPanelRemaining) - 1;
        state.actionStep = "TOXIN_DISCARD";
      } else state.actionStep = "ACTIVATE";
    });
    transitions.push(...result.transitions);
    return true;
  }
  if (state.actionStep === "APOTHECARION_FACING") {
    requestDecision(state, apothecarionFacingDecision(state, runtime.data.controlPanelMarineId as string), transitions);
    return false;
  }
  if (state.actionStep === "TELEPORTARIUM_ROLL" || state.actionStep === "GENETORIUM_ROLL" || state.actionStep === "LAUNCH_CONTROL_ROLL" || state.actionStep === "TOXIN_ROLL") {
    const rng = Sha256CounterRng.restore(state.rng);
    const face = rng.rollCombatDie();
    const resultingRng = rng.snapshot();
    const purpose = state.actionStep;
    transitions.push(commitTransition(state, "DIE_ROLLED", state.currentLocationInstanceId, () => {
      state.rng = resultingRng;
      state.activeDie = { id: `die.${state.transitionSeq + 1}`, sourceId: state.currentLocationInstanceId, purpose, rawValue: face.value, skull: face.skull, modifiedValue: face.value, rerolls: [] };
      state.actionStep = purpose.replace("_ROLL", "_RESOLVE");
    }, { randomInputs: [{ operationSeq: resultingRng.operationSeq, kind: "DIE", sourceId: state.currentLocationInstanceId, cardId: null, preLength: null, postLength: null, resultingRng }] }));
    return true;
  }
  if (state.actionStep === "TELEPORTARIUM_RESOLVE") {
    const marineId = runtime.data.controlPanelMarineId as string;
    transitions.push(commitTransition(state, state.activeDie!.rawValue === 0 ? "MARINE_SLAIN" : "LOCATION_EFFECT_RESOLVED", state.currentLocationInstanceId, () => {
      if (state.activeDie!.rawValue === 0) slayMarine(state, marineId);
      runtime.data[`teleportarium.${marineId}`] = true;
      delete runtime.data.controlPanelMarineId;
      state.activeDie = null;
      state.actionStep = "CONTROL_PANEL";
    }));
    return state.status === "IN_PROGRESS";
  }
  if (state.actionStep === "GENETORIUM_RESOLVE") {
    const marineId = runtime.data.controlPanelMarineId as string;
    transitions.push(commitTransition(state, state.activeDie!.skull ? "GENETORIUM_ATTACK_SUCCEEDED" : "MARINE_SLAIN", state.currentLocationInstanceId, () => {
      if (state.activeDie!.skull) {
        runtime.data.controlPanelRemaining = 4;
        state.actionStep = "GENETORIUM_SLAY";
      } else {
        slayMarine(state, marineId);
        state.actionStep = "ACTIVATE";
      }
      state.activeDie = null;
    }));
    return state.status === "IN_PROGRESS";
  }
  if (state.actionStep === "GENETORIUM_SLAY") {
    const remaining = Number(runtime.data.controlPanelRemaining ?? 0);
    const decision = remaining > 0 ? allGenestealerSlayDecision(state, "GENETORIUM_SLAY", "location.genetorium", true) : null;
    if (decision) { requestDecision(state, decision, transitions); return false; }
    transitions.push(commitTransition(state, "LOCATION_EFFECT_RESOLVED", state.currentLocationInstanceId, () => { state.actionStep = "ACTIVATE"; }));
    return true;
  }
  if (state.actionStep === "LAUNCH_CONTROL_RESOLVE") {
    const target = state.locationSupport[state.currentLocationInstanceId] ?? 0;
    transitions.push(commitTransition(state, state.activeDie!.rawValue <= target ? "GAME_WON" : "LOCATION_EFFECT_RESOLVED", state.currentLocationInstanceId, () => {
      if (state.activeDie!.rawValue <= target) {
        finishVictoryState(state);
      } else state.actionStep = "ACTIVATE";
      state.activeDie = null;
    }));
    return state.status === "IN_PROGRESS";
  }
  if (state.actionStep === "TOXIN_RESOLVE") {
    transitions.push(commitTransition(state, "TOXIN_DISCARD_COUNT_DETERMINED", state.currentLocationInstanceId, () => {
      runtime.data.controlPanelRemaining = state.activeDie!.rawValue;
      state.activeDie = null;
      state.actionStep = "TOXIN_DISCARD";
    }));
    return true;
  }
  if (state.actionStep === "TOXIN_DISCARD") {
    if (Number(runtime.data.controlPanelRemaining ?? 0) <= 0) {
      transitions.push(commitTransition(state, "LOCATION_EFFECT_RESOLVED", state.currentLocationInstanceId, () => { state.actionStep = "ACTIVATE"; }));
      return true;
    }
    const decision = controlPanelBlipDecision(state, "TOXIN_BLIP", "location.toxinPumpingStation");
    if (decision) { requestDecision(state, decision, transitions); return false; }
    transitions.push(commitTransition(state, "LOCATION_EFFECT_RESOLVED", state.currentLocationInstanceId, () => { state.actionStep = "ACTIVATE"; }));
    return true;
  }
  throw new Error(`Unknown Control Panel step: ${state.actionStep}`);
}

function beginTravelTransition(state: GameState, returnPhase: GameState["phase"]): TransitionRecord {
  return commitTransition(state, "TRAVEL_STARTED", state.currentLocationInstanceId, () => {
    state.pendingQueue = state.pendingQueue.filter((checkpoint) => checkpoint.timing !== "TRAVEL_REQUIRED" && checkpoint.sourceId !== "GENESTEALER_ATTACK");
    state.genestealerAttackQueue = [];
    state.currentGenestealerAttackIndex = 0;
    state.genestealerAttackStep = null;
    state.genestealerAttackRuntime = null;
    state.activeDie = null;
    state.travelRuntime = { returnPhase, doorRemaining: totalDoorSupport(state), arrivalRemaining: 0, activatingMarineId: null, data: {} };
    state.travelStep = "DOOR";
  });
}

function advanceTravel(state: GameState, transitions: TransitionRecord[]): boolean {
  const runtime = state.travelRuntime!;
  if (state.travelStep === "DOOR") {
    const decision = doorTravelDecision(state);
    if (decision) { requestDecision(state, decision, transitions); return false; }
    transitions.push(commitTransition(state, "DOOR_ABILITY_FINISHED", "terrain.door", () => {
      runtime.doorRemaining = 0;
      state.travelStep = "DRAW_LOCATION";
    }));
    return true;
  }
  if (state.travelStep === "DRAW_LOCATION") {
    const priorLocationId = state.currentLocationInstanceId;
    const rng = Sha256CounterRng.restore(state.rng);
    const result = drawCard(state, rng, "location.deck", { zone: "CURRENT", containerId: null }, (locationId) => {
      state.components[priorLocationId].zone = "PREVIOUS";
      state.components[priorLocationId].containerId = null;
      state.currentLocationInstanceId = locationId;
      state.travelRuntime!.data.locationId = locationId;
      state.travelStep = "TERRAIN";
    });
    transitions.push(...result.transitions);
    return true;
  }
  if (state.travelStep === "TERRAIN") {
    transitions.push(commitTransition(state, "TERRAIN_REPLACED", state.currentLocationInstanceId, () => {
      discardOldTerrain(state);
      placeLocationTerrain(state, state.currentLocationInstanceId);
      state.travelStep = "BLIPS_DISCARD";
    }));
    return true;
  }
  if (state.travelStep === "BLIPS_DISCARD") {
    transitions.push(commitTransition(state, "BLIPS_DISCARDED", state.currentLocationInstanceId, () => {
      discardBlips(state);
      const targets = computeBlipTargets(state, state.currentLocationInstanceId);
      runtime.data.leftTarget = targets.left;
      runtime.data.rightTarget = targets.right;
      state.travelStep = "BLIPS_REFILL";
    }));
    return true;
  }
  if (state.travelStep === "BLIPS_REFILL") {
    const side = nextRefillSide(state);
    if (!side) {
      transitions.push(commitTransition(state, "BLIPS_REFILLED", state.currentLocationInstanceId, () => { state.travelStep = "ARRIVAL"; }));
      return true;
    }
    const sourceId = side === "LEFT" ? "blip.left" : "blip.right";
    const rng = Sha256CounterRng.restore(state.rng);
    const result = drawCard(state, rng, "genestealer.deck", { zone: side === "LEFT" ? "LEFT_BLIP" : "RIGHT_BLIP", containerId: sourceId }, (cardId) => {
      state.orderedSources[sourceId].push(cardId);
    });
    transitions.push(...result.transitions);
    return true;
  }
  if (state.travelStep === "ARRIVAL") {
    const handlerId = locationDefinition(state.currentLocationInstanceId).handlerId;
    if (handlerId === "location.service-shaft") {
      transitions.push(commitTransition(state, "LOCATION_EFFECT_RESOLVED", state.currentLocationInstanceId, () => {
        for (const marine of Object.values(state.marines)) marine.facing = "RIGHT";
        state.travelStep = "VICTORY_CHECK";
      }));
      return true;
    }
    if (handlerId === "location.wreckage-labyrinth") {
      transitions.push(commitTransition(state, "LOCATION_EFFECT_RESOLVED", state.currentLocationInstanceId, () => {
        state.formation.forEach((slot) => {
          const marine = state.marines[slot.marineInstanceId];
          if (slot.terrainInstanceIds[marine.facing].length) marine.facing = marine.facing === "LEFT" ? "RIGHT" : "LEFT";
        });
        state.travelStep = "VICTORY_CHECK";
      }));
      return true;
    }
    if (handlerId === "location.munitorium") {
      transitions.push(commitTransition(state, "LOCATION_EFFECT_STARTED", state.currentLocationInstanceId, () => {
        runtime.arrivalRemaining = Math.min(2, state.supportSupply, state.formation.length);
        state.travelStep = "MUNITORIUM";
      }));
      return true;
    }
    if (handlerId === "location.wrath-of-baal-chapel") {
      requestDecision(state, artefactPlacementDecision(state), transitions);
      return false;
    }
    if (handlerId === "location.dark-catacombs") {
      const hasZero = Object.values(state.marines).some((marine) => marine.support === 0);
      requestDecision(state, arrivalMarineDecision(state, "DARK_CATACOMBS_MARINE", "location.darkCatacombs", hasZero ? (id) => state.marines[id].support === 0 : undefined)!, transitions);
      return false;
    }
    if (handlerId === "location.black-holds") {
      const decision = swarmChoiceDecision(state, "BLACK_HOLDS_SWARM", "location.blackHolds");
      if (decision) { requestDecision(state, decision, transitions); return false; }
      transitions.push(commitTransition(state, "LOCATION_EFFECT_RESOLVED", state.currentLocationInstanceId, () => { state.travelStep = "VICTORY_CHECK"; }));
      return true;
    }
    if (handlerId === "location.genestealer-lair") {
      transitions.push(commitTransition(state, "LOCATION_EFFECT_RESOLVED", state.currentLocationInstanceId, () => {
        moveSwarmsToRedTerrain(state);
        spawnBroodLordsAtRedTerrain(state);
        state.travelStep = "VICTORY_CHECK";
      }));
      return true;
    }
    if (handlerId === "location.main-corridor") {
      const corridor = Object.values(state.terrain).find((terrain) => state.components[terrain.instanceId].definitionId === "terrain.corridor")!;
      transitions.push(commitTransition(state, "LOCATION_EFFECT_STARTED", state.currentLocationInstanceId, () => {
        runtime.data.arrivalPosition = corridor.positionIndex;
        runtime.data.arrivalSide = corridor.side;
        runtime.arrivalRemaining = 2;
        state.travelStep = "ARRIVAL_SPAWN";
      }));
      return true;
    }
    if (handlerId === "location.lower-accessway") {
      const topMarine = state.formation[0].marineInstanceId;
      transitions.push(commitTransition(state, "LOCATION_EFFECT_STARTED", state.currentLocationInstanceId, () => {
        runtime.data.arrivalPosition = 0;
        runtime.data.arrivalSide = state.marines[topMarine].facing === "LEFT" ? "RIGHT" : "LEFT";
        runtime.arrivalRemaining = 2;
        state.travelStep = "ARRIVAL_SPAWN";
      }));
      return true;
    }
    if (handlerId === "location.hibernation-cluster") {
      transitions.push(commitTransition(state, "LOCATION_EFFECT_STARTED", state.currentLocationInstanceId, () => {
        runtime.arrivalRemaining = state.formation.length * 2;
        runtime.data.arrivalBlipSide = "LEFT";
        state.travelStep = "ARRIVAL_BLIP";
      }));
      return true;
    }
    transitions.push(commitTransition(state, "LOCATION_EFFECT_RESOLVED", state.currentLocationInstanceId, () => { state.travelStep = "VICTORY_CHECK"; }));
    return true;
  }
  if (state.travelStep === "MUNITORIUM") {
    if (runtime.arrivalRemaining <= 0 || state.supportSupply <= 0) {
      transitions.push(commitTransition(state, "LOCATION_EFFECT_RESOLVED", state.currentLocationInstanceId, () => { state.travelStep = "VICTORY_CHECK"; }));
      return true;
    }
    const decision = arrivalMarineDecision(state, "MUNITORIUM_SUPPORT", "location.munitorium", (id) => runtime.data[`munitorium.${id}`] !== true);
    if (decision) { requestDecision(state, decision, transitions); return false; }
    transitions.push(commitTransition(state, "LOCATION_EFFECT_RESOLVED", state.currentLocationInstanceId, () => { state.travelStep = "VICTORY_CHECK"; }));
    return true;
  }
  if (state.travelStep === "ARRIVAL_SPAWN") {
    if (runtime.arrivalRemaining <= 0) {
      transitions.push(commitTransition(state, "LOCATION_EFFECT_RESOLVED", state.currentLocationInstanceId, () => { state.travelStep = "VICTORY_CHECK"; }));
      return true;
    }
    if (state.orderedSources["genestealer.deck"].length + state.orderedSources["genestealer.discard"].length === 0) {
      transitions.push(commitTransition(state, "SPAWN_UNAVAILABLE", state.currentLocationInstanceId, () => { runtime.arrivalRemaining = 0; }));
      return true;
    }
    let positionIndex = Number(runtime.data.arrivalPosition ?? 0);
    let side = (runtime.data.arrivalSide ?? "LEFT") as "LEFT" | "RIGHT";
    const swarmId = runtime.data.arrivalSwarmId as string | undefined;
    const marineId = runtime.data.arrivalMarineId as string | undefined;
    if (swarmId && state.swarms[swarmId]) { positionIndex = state.swarms[swarmId].positionIndex; side = state.swarms[swarmId].side; }
    if (marineId && state.marines[marineId]) {
      positionIndex = state.formation.findIndex((slot) => slot.marineInstanceId === marineId);
      side = state.marines[marineId].facing === "LEFT" ? "RIGHT" : "LEFT";
    }
    const rng = Sha256CounterRng.restore(state.rng);
    const result = drawCard(state, rng, "genestealer.deck", { zone: "SWARM", containerId: null }, (cardId) => {
      addGenestealerToSwarm(state, cardId, positionIndex, side);
      state.travelRuntime!.arrivalRemaining -= 1;
    });
    transitions.push(...result.transitions);
    return true;
  }
  if (state.travelStep === "ARRIVAL_BLIP") {
    if (runtime.arrivalRemaining <= 0 || state.orderedSources["genestealer.deck"].length + state.orderedSources["genestealer.discard"].length === 0) {
      transitions.push(commitTransition(state, "LOCATION_EFFECT_RESOLVED", state.currentLocationInstanceId, () => { state.travelStep = "VICTORY_CHECK"; }));
      return true;
    }
    const side = runtime.data.arrivalBlipSide as "LEFT" | "RIGHT";
    const sourceId = side === "LEFT" ? "blip.left" : "blip.right";
    const rng = Sha256CounterRng.restore(state.rng);
    const result = drawCard(state, rng, "genestealer.deck", { zone: side === "LEFT" ? "LEFT_BLIP" : "RIGHT_BLIP", containerId: sourceId }, (cardId) => {
      state.orderedSources[sourceId].push(cardId);
      state.travelRuntime!.arrivalRemaining -= 1;
      state.travelRuntime!.data.arrivalBlipSide = side === "LEFT" ? "RIGHT" : "LEFT";
    });
    transitions.push(...result.transitions);
    return true;
  }
  if (state.travelStep === "VICTORY_CHECK") {
    transitions.push(commitTransition(state, "TRAVEL_COMPLETED", state.currentLocationInstanceId, () => {
      state.phase = runtime.returnPhase;
      state.travelStep = null;
      state.travelRuntime = null;
    }));
    return true;
  }
  throw new Error(`Unknown travel step: ${state.travelStep}`);
}

function victorySatisfied(state: GameState): boolean {
  if (!state.currentLocationInstanceId.startsWith("location.")) return false;
  const handlerId = locationDefinition(state.currentLocationInstanceId).handlerId;
  if (handlerId === "location.genestealer-lair") {
    const broodLordsSlain = ["brood-lord.a.01", "brood-lord.b.01"].every((id) => state.components[id].zone === "DISCARD");
    if (broodLordsSlain) return true;
  }
  return genericFinalVictory(state);
}

function finishVictoryState(state: GameState): void {
  state.status = "VICTORY";
  state.phase = "GAME_OVER";
  state.pendingDecision = null;
  state.pendingQueue = [];
  state.actionQueue = [];
  state.currentActionIndex = 0;
  state.actionStep = null;
  state.actionRuntime = null;
  state.genestealerAttackQueue = [];
  state.currentGenestealerAttackIndex = 0;
  state.genestealerAttackStep = null;
  state.genestealerAttackRuntime = null;
}

function advanceGenestealerAttack(state: GameState, transitions: TransitionRecord[]): boolean {
  if (state.genestealerAttackQueue.length === 0 && state.currentGenestealerAttackIndex === 0 && !state.genestealerAttackRuntime) {
    const queue = buildGenestealerAttackQueue(state);
    transitions.push(commitTransition(state, "GENESTEALER_ATTACK_QUEUE_BUILT", "GENESTEALER_ATTACK", () => {
      state.genestealerAttackQueue = queue;
      state.currentGenestealerAttackIndex = 0;
      state.pendingQueue = state.pendingQueue.filter((checkpoint) => checkpoint.sourceId !== "GENESTEALER_ATTACK");
      for (const swarm of Object.values(state.swarms)) swarm.attackedThisAttackPhase = false;
    }));
  }
  if (state.currentGenestealerAttackIndex >= state.genestealerAttackQueue.length) {
    if (travelRequired(state)) {
      transitions.push(beginTravelTransition(state, "EVENT"));
      return true;
    }
    transitions.push(commitTransition(state, "PHASE_ENDED", "GENESTEALER_ATTACK", () => {
      state.phase = "EVENT";
      state.genestealerAttackQueue = [];
      state.currentGenestealerAttackIndex = 0;
      state.genestealerAttackStep = null;
      state.genestealerAttackRuntime = null;
      state.activeDie = null;
      state.pendingQueue.push({ id: `checkpoint.${state.transitionSeq + 1}.event`, sourceId: "EVENT", timing: "PHASE_START", kind: "CHECK", mandatory: true, affectedIds: [], decisionId: null });
    }));
    return false;
  }

  const swarmId = state.genestealerAttackQueue[state.currentGenestealerAttackIndex];
  const swarm = state.swarms[swarmId];
  if (!state.genestealerAttackRuntime) {
    if (!swarm) {
      transitions.push(commitTransition(state, "GENESTEALER_ATTACK_UNAVAILABLE", swarmId, () => { state.currentGenestealerAttackIndex += 1; }));
      return true;
    }
    if (swarmCannotAttack(state, swarmId)) {
      transitions.push(commitTransition(state, "GENESTEALER_ATTACK_PREVENTED", swarmId, () => {
        swarm.attackedThisAttackPhase = true;
        state.currentGenestealerAttackIndex += 1;
      }));
      return true;
    }
    const defenderMarineId = defendingMarineId(state, swarmId);
    if (!defenderMarineId) {
      transitions.push(commitTransition(state, "GENESTEALER_ATTACK_UNAVAILABLE", swarmId, () => { state.currentGenestealerAttackIndex += 1; }));
      return true;
    }
    transitions.push(commitTransition(state, "GENESTEALER_ATTACK_STARTED", swarmId, () => {
      swarm.attackedThisAttackPhase = true;
      state.genestealerAttackRuntime = { swarmId, defenderMarineId, repeatAttack: false, rerolledWithSupport: false };
      state.genestealerAttackStep = "ROLL";
    }));
    return true;
  }

  const runtime = state.genestealerAttackRuntime;
  if (state.genestealerAttackStep === "ROLL") {
    const rng = Sha256CounterRng.restore(state.rng);
    const face = rng.rollCombatDie();
    const resultingRng = rng.snapshot();
    const prior = state.activeDie;
    const penalty = broodLordCount(state, runtime.swarmId);
    transitions.push(commitTransition(state, prior ? "DIE_REROLLED" : "DIE_ROLLED", runtime.swarmId, () => {
      state.rng = resultingRng;
      state.activeDie = {
        id: prior?.id ?? `die.${state.transitionSeq + 1}`,
        sourceId: runtime.swarmId,
        purpose: "GENESTEALER_DEFENSE",
        rawValue: face.value,
        skull: face.skull,
        modifiedValue: face.value - penalty,
        rerolls: prior ? [...prior.rerolls, { rawValue: prior.rawValue, skull: prior.skull, modifiedValue: prior.modifiedValue }] : [],
      };
      state.genestealerAttackStep = "TRIGGERS";
    }, { randomInputs: [{ operationSeq: resultingRng.operationSeq, kind: "DIE", sourceId: runtime.swarmId, cardId: null, preLength: null, postLength: null, resultingRng }] }));
    return true;
  }

  if (state.genestealerAttackStep === "TRIGGERS") {
    const marineId = runtime.defenderMarineId;
    if (state.activeDie!.rawValue === 0 && hasRoundAbility(state, "event.second-wind", marineId)) {
      transitions.push(commitTransition(state, "GENESTEALER_ATTACK_MISSED", runtime.swarmId, () => { finishGenestealerAttack(state); }));
      return true;
    }
    if (state.activeDie!.skull && hasRoundAbility(state, "action.block", marineId)) {
      transitions.push(commitTransition(state, "GENESTEALER_ATTACK_MISSED", runtime.swarmId, () => { finishGenestealerAttack(state); }));
      return true;
    }
    if (state.activeDie!.skull && hasRoundAbility(state, "action.counter-attack", marineId)) {
      const eligible = eligibleSlainCards(state, runtime.swarmId);
      const distinctEligible = mechanicallyDistinctSlainCards(state, runtime.swarmId);
      if (distinctEligible.length === 1) {
        transitions.push(commitTransition(state, "COUNTER_ATTACK_RESOLVED", runtime.swarmId, () => {
          slayGenestealer(state, runtime.swarmId, distinctEligible[0]);
          finishCounterAttack(state, runtime.swarmId);
        }));
        return true;
      }
      if (eligible.length > 1) {
        requestDecision(state, counterAttackSlayDecision(state, runtime.swarmId)!, transitions);
        return false;
      }
      transitions.push(commitTransition(state, "COUNTER_ATTACK_RESOLVED", runtime.swarmId, () => { finishCounterAttack(state, runtime.swarmId); }));
      return true;
    }
    if (runtime.rerolledWithSupport && state.activeDie!.rawValue !== 0 && hasRoundAbility(state, "action.defensive-stance", marineId)) {
      transitions.push(commitTransition(state, "GENESTEALER_ATTACK_MISSED", runtime.swarmId, () => { finishGenestealerAttack(state); }));
      return true;
    }
    transitions.push(commitTransition(state, "DEFENSE_TRIGGERS_RESOLVED", runtime.swarmId, () => { state.genestealerAttackStep = "REROLL"; }));
    return true;
  }

  if (state.genestealerAttackStep === "REROLL") {
    const decision = defenseRerollDecision(state, runtime.swarmId, runtime.defenderMarineId);
    if (decision) {
      requestDecision(state, decision, transitions);
      return false;
    }
    transitions.push(commitTransition(state, "DIE_RESULT_KEPT", runtime.swarmId, () => { state.genestealerAttackStep = "RESOLVE"; }));
    return true;
  }

  if (state.genestealerAttackStep === "RESOLVE") {
    const slain = state.activeDie!.modifiedValue <= swarmSize(state, runtime.swarmId);
    transitions.push(commitTransition(state, slain ? "MARINE_SLAIN" : "GENESTEALER_ATTACK_MISSED", runtime.swarmId, () => {
      const defenderMarineId = runtime.defenderMarineId;
      if (slain) slayMarine(state, defenderMarineId);
      finishGenestealerAttack(state);
    }));
    return state.status === "IN_PROGRESS";
  }

  throw new Error(`Unknown Genestealer attack step: ${state.genestealerAttackStep}`);
}

function finishCounterAttack(state: GameState, swarmId: string): void {
  if (state.swarms[swarmId] && swarmSize(state, swarmId) > 0 && !swarmCannotAttack(state, swarmId)) {
    state.activeDie = null;
    state.genestealerAttackRuntime!.repeatAttack = true;
    state.genestealerAttackRuntime!.rerolledWithSupport = false;
    state.genestealerAttackStep = "ROLL";
  } else finishGenestealerAttack(state);
}

function finishGenestealerAttack(state: GameState): void {
  state.activeDie = null;
  state.genestealerAttackRuntime = null;
  state.genestealerAttackStep = null;
  state.currentGenestealerAttackIndex += 1;
}

function finishRunAndGunAttack(state: GameState, marineId: string): void {
  state.actionRuntime!.specialResolvedMarineIds.push(marineId);
  delete state.actionRuntime!.data.attackerId;
  delete state.actionRuntime!.data.targetSwarmId;
  state.activeDie = null;
  state.actionStep = "RUN_AND_GUN";
}

function markAttackStarted(state: GameState, marineId: string): void {
  const runtime = state.actionRuntime!;
  if (state.roundEffects.some((effect) => effect.data.handlerId === "event.evasion" && Number(effect.data.activeRound) === state.round)) runtime.data.evasionMarineId = marineId;
  runtime.data.attackSlainThisAttack = false;
  const key = `attackCount.${marineId}`;
  runtime.data[key] = Number(runtime.data[key] ?? 0) + 1;
  if (!runtime.specialResolvedMarineIds.includes(marineId)) runtime.specialResolvedMarineIds.push(marineId);
  if (runtime.data.attackWasBonus === true) {
    runtime.data.psionicBonusAttacks = Math.max(0, Number(runtime.data.psionicBonusAttacks ?? 0) - 1);
  }
}

function finishStandardAttack(state: GameState, handlerId: string): void {
  const runtime = state.actionRuntime!;
  const marineId = runtime.data.attackerId as string;
  const killed = runtime.data.attackSlainThisAttack === true;
  const skull = state.activeDie?.skull === true;
  if (handlerId === "action.psionic-attack" && marineId === "marine.grey.lexicanium-calistarius" && skull) {
    runtime.data.psionicBonusAttacks = Number(runtime.data.psionicBonusAttacks ?? 0) + 1;
  }
  delete runtime.data.attackerId;
  delete runtime.data.targetSwarmId;
  delete runtime.data.attackWasBonus;
  delete runtime.data.attackKillsRemaining;
  delete runtime.data.attackSlainThisAttack;
  delete runtime.data.heroicRemaining;
  state.activeDie = null;
  if (handlerId === "action.lead-by-example" && killed && runtime.data.leadByExampleUsed !== true && state.supportSupply > 0) {
    state.actionStep = "LEAD_BY_EXAMPLE";
  } else state.actionStep = "ATTACK";
}

function rollAttackDie(state: GameState, actionId: string, purpose: string, transitions: TransitionRecord[]): void {
  const rng = Sha256CounterRng.restore(state.rng);
  const face = rng.rollCombatDie();
  const resultingRng = rng.snapshot();
  const prior = state.activeDie;
  transitions.push(commitTransition(state, prior ? "DIE_REROLLED" : "DIE_ROLLED", actionId, () => {
    state.rng = resultingRng;
    state.activeDie = {
      id: prior?.id ?? `die.${state.transitionSeq + 1}`,
      sourceId: actionId,
      purpose,
      rawValue: face.value,
      skull: face.skull,
      modifiedValue: face.value,
      rerolls: prior ? [...prior.rerolls, { rawValue: prior.rawValue, skull: prior.skull, modifiedValue: prior.modifiedValue }] : [],
    };
    state.actionStep = "ATTACK_REROLL";
  }, { randomInputs: [{ operationSeq: resultingRng.operationSeq, kind: "DIE", sourceId: actionId, cardId: null, preLength: null, postLength: null, resultingRng }] }));
}

function actionSelectionDecision(state: GameState, team: TeamColor): PendingDecision {
  const teamState = state.teams[team];
  const gunJammed = state.roundEffects.some((effect) => effect.data.handlerId === "event.gun-jam" && Number(effect.data.activeRound) === state.round && effect.targetIds.includes(team));
  const actions = teamState.actionInstanceIds.map(actionDefinition).filter((action) => !gunJammed || action.type !== "ATTACK");
  return makeDecision(state, "CHOOSE_ACTION", `team.${team.toLowerCase()}`, "actions.choose", actions.map((action) => ({
    id: `action:${action.id}`,
    label: `${action.name} · Initiative ${action.initiative}`,
    payload: { team, actionId: action.id },
    canonicalEffectPreview: action.sourceText,
  })).filter((option) => option.payload.actionId !== teamState.previousActionInstanceId));
}

function lockActions(state: GameState, transitions: TransitionRecord[]): void {
  const queue = state.activeTeams.map((team) => state.teams[team].chosenActionInstanceId).filter((id): id is string => id !== null).sort((a, b) => actionDefinition(a).initiative - actionDefinition(b).initiative);
  transitions.push(commitTransition(state, "ACTIONS_LOCKED", "CHOOSE_ACTIONS", () => {
    state.actionQueue = queue;
    state.currentActionIndex = 0;
    state.currentPlayerTeam = actionDefinition(queue[0]).team;
    for (const actionId of queue) {
      state.components[actionId].zone = "SELECTED";
      state.components[actionId].containerId = "action.queue";
    }
    state.phase = "RESOLVE_ACTIONS";
  }));
}

function requestDecision(state: GameState, decision: PendingDecision, transitions: TransitionRecord[]): void {
  const checkpoint: PendingCheckpoint = { id: `checkpoint.${state.transitionSeq + 1}.${decision.type.toLowerCase()}`, sourceId: decision.sourceId, timing: state.phase, kind: "DECISION", mandatory: true, affectedIds: decision.legalOptions.map((option) => option.id), decisionId: decision.id };
  transitions.push(commitTransition(state, "DECISION_REQUESTED", decision.sourceId, () => {
    state.pendingDecision = decision;
    state.pendingQueue.push(checkpoint);
  }, { generatedCheckpoints: [checkpoint.id] }));
}

function clearPendingDecision(state: GameState, decision: PendingDecision): void {
  state.pendingDecision = null;
  state.pendingQueue = state.pendingQueue.filter((checkpoint) => checkpoint.decisionId !== decision.id);
}
