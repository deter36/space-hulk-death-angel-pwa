"use client";

import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type CSSProperties } from "react";
import dataJson from "@/src/data/generated/base-game.json";
import {
  canUndo,
  getUndoStatus,
  loadEngineSession,
  newEngineSession,
  serializeEngineSession,
  stateHash,
  submitSessionDecision,
  undo,
  type EngineSession,
  type GameState,
  type PendingDecision,
} from "@/src/engine";
import type { GenestealerIcon, Side, TeamColor } from "@/src/data/types";
import { EngineSessionStallError, settleEngineSession } from "@/src/ui-adapter/session-settler";
import { COMBAT_DIE_FACES, combatDieFace, type CombatDieValue } from "@/src/ui-adapter/combat-die";
import { isOffBoardMarineOption, presentedDecisionOption } from "@/src/ui-adapter/decision-presentation";
import { strategizeDestinationOption, strategizeSwarmIds } from "@/src/ui-adapter/strategize-selection";
import FormationBoard, { cellKey, type LabOverlayChoice, type LabTargetState } from "@/src/ui-lab/formation-board";
import type { LabFormationRow } from "@/src/ui-lab/formation-types";
import "@/src/ui-lab/ui-lab.css";

type Definition = { id: string; name: string };
type MarineDefinition = Definition & { team: TeamColor; attackRange: number; namedActionAbility: string | null };
type ActionDefinition = Definition & { team: TeamColor; initiative: number; type: string; sourceText: string };
type TerrainDefinition = Definition & { spawnColor: string; activatable: boolean; sourceText: string | null };
type LocationDefinition = Definition & { tier: string; leftBlips: number; rightBlips: number; abilityTiming: string | null; sourceText: string | null };
type SetupLocationDefinition = Definition;
type EventDefinition = Definition & { copyIndex: number | null; sourceText: string; movementIcon: GenestealerIcon | null; movement: string | null; activations: Array<{ severity: "MAJOR" | "MINOR"; terrainColor: string }> };
type Instance = { id: string; definitionId: string };
type GameDatabase = {
  definitions: {
    marines: MarineDefinition[];
    actions: ActionDefinition[];
    terrain: TerrainDefinition[];
    locations: LocationDefinition[];
    setupLocations: SetupLocationDefinition[];
    events: EventDefinition[];
  };
  instances: { events: Instance[] };
};

type Inspection = {
  eyebrow: string;
  title: string;
  body: string;
  meta?: string;
};

type RollNotice = {
  preRollAnimation: BoardAnimation | null;
  postRollAnimation: BoardAnimation | null;
  id: string;
  value: number;
  skull: boolean;
  title: string;
  reroll: boolean;
};

type BoardAnimation = {
  marineAnimation?: "death" | "dodge" | "fire-straight" | "fire-up" | "fire-down" | "gunJam-straight" | "gunJam-up" | "gunJam-down";
  marineId?: string;
  swarmAnimation?: "attack" | "death";
  swarmId?: string;
};

type PendingRollResolution = { session: EngineSession };

type RollLanding = {
  bounceX: string;
  bounceY: string;
  midOneX: string;
  midOneY: string;
  midTwoX: string;
  midTwoY: string;
  spinBounce: string;
  spinMidOne: string;
  spinMidTwo: string;
  spinStart: string;
  startX: string;
  startY: string;
  x: number;
  y: number;
};

const data = dataJson as unknown as GameDatabase;
const TEAM_COLORS: TeamColor[] = ["GREEN", "YELLOW", "BLUE", "RED", "PURPLE", "GREY"];
const ICON_GLYPHS: Record<GenestealerIcon, string> = { HEAD: "◉", TAIL: "⌁", CLAW: "ϟ", TONGUE: "⌇" };
const ICON_LABELS: Record<GenestealerIcon, string> = { HEAD: "Head", TAIL: "Tail", CLAW: "Claw", TONGUE: "Tongue" };
const SAVED_GAME_KEY = "death-angel.engine-session.v1";
const HOLD_DURATION_MS = 420;

function prepareUiSession(session: EngineSession): { session: EngineSession; error: string | null } {
  try {
    return { session: settleEngineSession(session), error: null };
  } catch (caught) {
    if (caught instanceof EngineSessionStallError) return { session: caught.session, error: caught.message };
    throw caught;
  }
}

function diagnosticText(session: EngineSession): string {
  const serializedSession = serializeEngineSession(session);
  return JSON.stringify({
    reportVersion: "1",
    capturedAt: new Date().toISOString(),
    buildVersion: __BUILD_VERSION__,
    pageUrl: globalThis.location?.href ?? null,
    userAgent: globalThis.navigator?.userAgent ?? null,
    stateHash: stateHash(session.state),
    phase: session.state.phase,
    status: session.state.status,
    transitionSeq: session.state.transitionSeq,
    pendingDecision: session.state.pendingDecision,
    recentTransitions: session.transitions.slice(-25),
    session: JSON.parse(serializedSession) as unknown,
  }, null, 2);
}

function formatPhase(phase: string): string {
  return phase.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatActionType(type: string): string {
  if (type === "MOVE_ACTIVATE") return "Move + Activate";
  return formatPhase(type);
}

function rollLanding(id: string): RollLanding {
  let hash = 2166136261;
  for (const character of id) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  let randomState = hash >>> 0;
  const random = () => {
    randomState += 0x6d2b79f5;
    let value = randomState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const x = Math.round(14 + random() * 72);
  const y = Math.round(18 + random() * 57);
  const edge = Math.floor(random() * 4);
  const startX = edge === 0 ? `calc(-${x}vw - 140px)` : edge === 1 ? `calc(${100 - x}vw + 140px)` : `${Math.round((random() - .5) * 86)}vw`;
  const startY = edge === 2 ? `calc(-${y}vh - 140px)` : edge === 3 ? `calc(${100 - y}vh + 140px)` : `${Math.round((random() - .5) * 70)}vh`;
  const spinDirection = random() > .5 ? 1 : -1;
  const spin = spinDirection * Math.round(680 + random() * 440);
  return {
    x,
    y,
    startX,
    startY,
    midOneX: `${Math.round((random() - .5) * 66)}vw`,
    midOneY: `${Math.round((random() - .5) * 52)}vh`,
    midTwoX: `${Math.round((random() - .5) * 34)}vw`,
    midTwoY: `${Math.round(-8 - random() * 17)}vh`,
    bounceX: `${Math.round((random() - .5) * 13)}vw`,
    bounceY: `${Math.round(4 + random() * 8)}vh`,
    spinStart: `${spin}deg`,
    spinMidOne: `${Math.round(spin * .62)}deg`,
    spinMidTwo: `${Math.round(spin * .29)}deg`,
    spinBounce: `${Math.round(spin * .08)}deg`,
  };
}

function componentDefinitionId(session: EngineSession, instanceId: string): string {
  return session.state.components[instanceId]?.definitionId ?? instanceId.split("#", 1)[0];
}

function findEvent(instanceId: string): EventDefinition | undefined {
  const definitionId = data.instances.events.find((item) => item.id === instanceId)?.definitionId ?? instanceId.replace(/\.\d{2}$/, "");
  return data.definitions.events.find((item) => item.id === definitionId);
}

function setupLocationName(id: string): string {
  return data.definitions.setupLocations.find((item) => item.id === id)?.name.replace(" - 1 player", "") ?? "Void Lock";
}

function teamMarineNames(team: TeamColor): string {
  return data.definitions.marines.filter((marine) => marine.team === team).map((marine) => marine.name.replace("Brother ", "")).join(" · ");
}

function sourceInspection(session: EngineSession, sourceId: string): Inspection | null {
  const definitionId = componentDefinitionId(session, sourceId);
  const action = data.definitions.actions.find((item) => item.id === definitionId);
  if (action) return { eyebrow: `${action.team} team · Initiative ${action.initiative}`, title: action.name, body: action.sourceText, meta: formatPhase(action.type) };
  const terrain = data.definitions.terrain.find((item) => item.id === definitionId);
  if (terrain) return { eyebrow: terrain.activatable ? "Activatable terrain" : "Terrain", title: terrain.name, body: terrain.sourceText ?? "No ability.", meta: `${terrain.spawnColor} spawn marker` };
  const marine = data.definitions.marines.find((item) => item.id === definitionId);
  if (marine) {
    const namedAction = marine.namedActionAbility ? data.definitions.actions.find((item) => item.team === marine.team && item.name === marine.namedActionAbility) : null;
    return { eyebrow: `${marine.team} combat team`, title: marine.name, body: namedAction ? `${namedAction.name}: ${namedAction.sourceText}` : "No named Action-card ability.", meta: `Attack range ${marine.attackRange}` };
  }
  const location = data.definitions.locations.find((item) => item.id === definitionId);
  if (location) return { eyebrow: `Location ${location.tier}`, title: location.name, body: location.sourceText ?? "No special Location ability.", meta: `Blips: ${location.leftBlips} left · ${location.rightBlips} right${location.abilityTiming ? ` · ${location.abilityTiming}` : ""}` };
  const event = findEvent(sourceId);
  if (event) return { eyebrow: event.copyIndex ? `Event · copy ${event.copyIndex}` : "Event", title: event.name, body: event.sourceText, meta: event.movementIcon ? `${ICON_LABELS[event.movementIcon]} · ${event.movement ?? "movement"}` : undefined };
  return null;
}

function pendingTargetIds(decision: PendingDecision | null): Set<string> {
  const targets = new Set<string>();
  if (!decision) return targets;
  for (const option of decision.legalOptions) {
    for (const [key, value] of Object.entries(option.payload)) {
      if (typeof value === "string" && /(Id|swarm|marine|terrain|card)/i.test(key)) targets.add(value);
      if (typeof value === "number" && (key === "positionIndex" || key === "to")) targets.add(`position:${value}`);
    }
  }
  return targets;
}

type DecisionOption = PendingDecision["legalOptions"][number];

function uniquePayloadOption(decision: PendingDecision | null, key: string, value: string | number, side?: Side): DecisionOption | null {
  if (!decision) return null;
  const matches = decision.legalOptions.filter((option) => option.payload[key] === value && (side === undefined || option.payload.side === side));
  return matches.length === 1 ? matches[0] : null;
}

function isDirectInputOption(decision: PendingDecision, option: DecisionOption): boolean {
  if (decision.type === "SET_FACING") return true;
  if (decision.type === "MOVE_MARINE" && !option.payload.finish) return true;
  // Individual Genestealer cards are not drawn on the formation, so their
  // choices must remain in the command dock instead of being treated as board
  // targets.
  for (const key of ["actionId", "terrainId", "swarmId", "marineId"] as const) {
    const value = option.payload[key];
    if ((typeof value === "string" || typeof value === "number") && uniquePayloadOption(decision, key, value)?.id === option.id) return true;
  }
  for (const key of ["positionIndex", "to"] as const) {
    const value = option.payload[key];
    const side = option.payload.side === "LEFT" || option.payload.side === "RIGHT" ? option.payload.side : undefined;
    if (typeof value === "number" && uniquePayloadOption(decision, key, value, side)?.id === option.id) return true;
  }
  return false;
}

function attackTrajectory(state: GameState, marineId: string, swarmId: string): "straight" | "up" | "down" {
  const marinePosition = state.formation.findIndex((slot) => slot.marineInstanceId === marineId);
  const swarmPosition = state.swarms[swarmId]?.positionIndex ?? marinePosition;
  return swarmPosition === marinePosition ? "straight" : swarmPosition < marinePosition ? "up" : "down";
}

function rollNoticesFrom(session: EngineSession, startingAt: number, priorState: GameState, selectedOption?: DecisionOption): RollNotice[] {
  const newTransitions = session.transitions.slice(startingAt);
  return newTransitions.flatMap((transition) => transition.randomInputs
    .filter((input) => input.kind === "DIE" && input.dieValue !== undefined)
    .map((input, index) => {
      const inspection = input.sourceId ? sourceInspection(session, input.sourceId) : null;
      const attackerId = session.state.actionRuntime?.data.attackerId
        ?? priorState.actionRuntime?.data.attackerId
        ?? selectedOption?.payload.marineId;
      const targetSwarmId = session.state.actionRuntime?.data.targetSwarmId
        ?? priorState.actionRuntime?.data.targetSwarmId
        ?? selectedOption?.payload.swarmId;
      const marineAttack = typeof attackerId === "string" && typeof targetSwarmId === "string" && !input.sourceId.startsWith("swarm.");
      const defense = input.sourceId.startsWith("swarm.");
      const marineId = marineAttack ? attackerId : defense
        ? session.state.genestealerAttackRuntime?.defenderMarineId
          ?? priorState.genestealerAttackRuntime?.defenderMarineId
          ?? priorState.formation[priorState.swarms[input.sourceId]?.positionIndex ?? -1]?.marineInstanceId
        : undefined;
      const hit = Boolean(input.dieSkull);
      const laterTransitions = newTransitions.filter((candidate) => candidate.seq > transition.seq);
      const defenseOutcome = laterTransitions.some((candidate) => candidate.type === "MARINE_SLAIN")
        ? "death"
        : laterTransitions.some((candidate) => candidate.type === "GENESTEALER_ATTACK_MISSED")
          ? "dodge"
          : null;
      const postRollAnimation: BoardAnimation | null = marineAttack && marineId
        ? { marineId, marineAnimation: `${hit ? "fire" : "gunJam"}-${attackTrajectory(priorState, marineId, targetSwarmId)}` as BoardAnimation["marineAnimation"], ...(hit ? { swarmId: targetSwarmId, swarmAnimation: "death" as const } : {}) }
        : defense && marineId && defenseOutcome
          ? { marineId, marineAnimation: defenseOutcome }
          : null;
      return {
        preRollAnimation: defense ? { swarmId: input.sourceId, swarmAnimation: "attack" } : null,
        postRollAnimation,
        id: `${transition.seq}.${index}`,
        value: input.dieValue!,
        skull: Boolean(input.dieSkull),
        title: inspection?.title ?? (input.sourceId.startsWith("swarm.") ? "Genestealer attack" : "Combat die"),
        reroll: transition.type === "DIE_REROLLED",
      };
    }));
}

type TacticalButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  onTap?: () => void;
  onHold?: () => void;
  stopPropagation?: boolean;
};

function TacticalButton({ onTap, onHold, stopPropagation, onPointerDown, onPointerUp, onPointerCancel, onPointerLeave, onContextMenu, ...props }: TacticalButtonProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const cancelTimer = () => {
    if (timer.current !== null) globalThis.clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <button
      {...props}
      onPointerDown={(event) => {
        held.current = false;
        if (onHold) timer.current = globalThis.setTimeout(() => { held.current = true; onHold(); }, HOLD_DURATION_MS);
        onPointerDown?.(event);
      }}
      onPointerUp={(event) => { cancelTimer(); onPointerUp?.(event); }}
      onPointerCancel={(event) => { cancelTimer(); onPointerCancel?.(event); }}
      onPointerLeave={(event) => { cancelTimer(); onPointerLeave?.(event); }}
      onContextMenu={(event) => { event.preventDefault(); onContextMenu?.(event); }}
      onClick={(event) => {
        if (stopPropagation) event.stopPropagation();
        if (held.current) {
          held.current = false;
          event.preventDefault();
          return;
        }
        onTap?.();
      }}
    />
  );
}

type LiveActionCard = ActionDefinition & { instanceId: string };

function LiveActionSelection({ session, onChooseOption }: { session: EngineSession; onChooseOption: (optionId: string) => void }) {
  const { state } = session;
  const decision = state.pendingDecision;
  const choosingActions = decision?.type === "CHOOSE_ACTION";
  const [expandedTeam, setExpandedTeam] = useState<TeamColor | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const cardsByTeam = useMemo(() => Object.fromEntries(state.activeTeams.map((team) => [team, state.teams[team].actionInstanceIds.map((instanceId) => {
    const definition = data.definitions.actions.find((item) => item.id === componentDefinitionId(session, instanceId));
    return definition ? { ...definition, instanceId } : null;
  }).filter((card): card is LiveActionCard => Boolean(card))])) as Partial<Record<TeamColor, LiveActionCard[]>>, [session, state.activeTeams, state.teams]);
  const selectedActionIds = choosingActions
    ? state.activeTeams.map((team) => state.teams[team].chosenActionInstanceId).filter((id): id is string => Boolean(id))
    : state.actionQueue;
  const selectedCards = selectedActionIds.map((instanceId) => {
    const definition = data.definitions.actions.find((item) => item.id === componentDefinitionId(session, instanceId));
    return definition ? { ...definition, instanceId } : null;
  }).filter((card): card is LiveActionCard => Boolean(card));
  const selectionComplete = selectedCards.length === state.activeTeams.length;
  const orderedCards = selectionComplete && !choosingActions ? [...selectedCards].sort((left, right) => left.initiative - right.initiative) : selectedCards;
  const displayTeams = choosingActions ? state.activeTeams : orderedCards.map((card) => card.team);
  const activeIndex = state.phase === "RESOLVE_ACTIONS" ? state.currentActionIndex : -1;

  const openTeam = (team: TeamColor) => {
    if (!choosingActions || state.teams[team].chosenActionInstanceId) return;
    setExpandedTeam(team);
    setPendingActionId(null);
  };
  const pendingOption = pendingActionId ? uniquePayloadOption(decision, "actionId", pendingActionId) : null;
  const expandedCards = expandedTeam ? cardsByTeam[expandedTeam] ?? [] : [];

  return (
    <section className={`live-action-dock ${expandedTeam ? "is-expanded" : ""}`} aria-label="Combat team action cards">
      {expandedTeam && choosingActions && (
        <div className={`live-expanded-hand lab-team-${expandedTeam.toLowerCase()}`}>
          <header><span>{expandedTeam} squad</span><strong>Choose an action</strong><button type="button" onClick={() => setExpandedTeam(null)} aria-label="Close action hand">×</button></header>
          <div className="live-full-action-grid">
            {expandedCards.map((card) => {
              const option = uniquePayloadOption(decision, "actionId", card.instanceId);
              const unavailable = !option;
              return <button type="button" key={card.instanceId} className={`live-full-action-card lab-team-${card.team.toLowerCase()} ${pendingActionId === card.instanceId ? "is-pending" : ""} ${unavailable ? "is-unavailable" : ""}`} disabled={unavailable} onClick={() => setPendingActionId(card.instanceId)}>
                <small>{formatActionType(card.type)}</small><strong>{card.name}</strong><b>Initiative {card.initiative}</b><p>{card.sourceText}</p>{unavailable && <i aria-hidden="true">×</i>}
              </button>;
            })}
          </div>
          <button type="button" className="live-confirm-action" disabled={!pendingOption} onClick={() => { if (pendingOption) onChooseOption(pendingOption.id); }}>Select action</button>
        </div>
      )}
      <div className="live-action-dock-heading"><span>{choosingActions ? "Select squad actions" : selectionComplete ? "Initiative order" : "Combat team cards"}</span><b>{choosingActions ? `${selectedCards.length}/${state.activeTeams.length}` : selectionComplete ? `${Math.min(activeIndex + 1, orderedCards.length)}/${orderedCards.length}` : ""}</b></div>
      <div className={`live-action-hands ${selectionComplete && !choosingActions ? "is-initiative-order" : ""}`}>
        {displayTeams.map((team, orderIndex) => {
          const cards = cardsByTeam[team] ?? [];
          const chosenId = state.teams[team].chosenActionInstanceId;
          const selected = cards.find((card) => card.instanceId === chosenId) ?? orderedCards.find((card) => card.team === team) ?? null;
          const resolutionState = !choosingActions && activeIndex >= 0 ? orderIndex < activeIndex ? "is-completed" : orderIndex === activeIndex ? "is-active" : "is-upcoming" : "";
          return <button key={team} type="button" className={`live-action-team-slot lab-team-${team.toLowerCase()} ${selected ? "has-selection" : ""} ${resolutionState}`} onClick={() => openTeam(team)} disabled={!choosingActions || Boolean(selected)}>
            <span className="live-action-team-name">{team}</span>
            {selected ? <span className="live-chosen-action"><small>{formatActionType(selected.type)} · {selected.initiative}</small><strong>{selected.name}</strong></span> : <span className="live-mini-hand">{cards.map((card, index) => {
              const unavailable = !uniquePayloadOption(decision, "actionId", card.instanceId);
              return <span key={card.instanceId} className={`live-mini-action-card ${unavailable ? "is-unavailable" : ""}`} style={{ "--card-index": index } as CSSProperties}><b>{card.type === "MOVE_ACTIVATE" ? "Move" : formatActionType(card.type)}</b></span>;
            })}</span>}
          </button>;
        })}
      </div>
    </section>
  );
}

export default function GameClient() {
  const [selectedTeams, setSelectedTeams] = useState<TeamColor[]>([]);
  const [session, setSession] = useState<EngineSession | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rollNotices, setRollNotices] = useState<RollNotice[]>([]);
  const [pendingRollResolution, setPendingRollResolution] = useState<PendingRollResolution | null>(null);
  const [boardAnimation, setBoardAnimation] = useState<BoardAnimation | null>(null);
  const [restoreComplete, setRestoreComplete] = useState(false);
  const animationTimer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);

  const clearBoardAnimationTimer = () => {
    if (animationTimer.current !== null) globalThis.clearTimeout(animationTimer.current);
    animationTimer.current = null;
  };

  const playBoardAnimation = (animation: BoardAnimation, duration: number, onComplete: () => void) => {
    clearBoardAnimationTimer();
    setBoardAnimation(animation);
    animationTimer.current = globalThis.setTimeout(() => {
      animationTimer.current = null;
      setBoardAnimation(null);
      onComplete();
    }, duration);
  };

  useEffect(() => {
    const restoreTimer = globalThis.setTimeout(() => {
      try {
        const saved = globalThis.localStorage?.getItem(SAVED_GAME_KEY);
        if (saved) {
          const prepared = prepareUiSession(loadEngineSession(saved));
          setSession(prepared.session);
          setError(prepared.error);
        }
      } catch {
        globalThis.localStorage?.removeItem(SAVED_GAME_KEY);
        setError("The previous local game could not be restored, so setup was reset.");
      } finally {
        setRestoreComplete(true);
      }
    }, 0);
    return () => globalThis.clearTimeout(restoreTimer);
  }, []);

  useEffect(() => {
    if (!restoreComplete || !session) return;
    globalThis.localStorage?.setItem(SAVED_GAME_KEY, serializeEngineSession(session));
  }, [restoreComplete, session]);

  const toggleTeam = (team: TeamColor) => {
    setSelectedTeams((current) => current.includes(team)
      ? current.filter((item) => item !== team)
      : current.length < 3 ? [...current, team] : current);
  };

  const startGame = () => {
    if (selectedTeams.length !== 3) return;
    try {
      const gameId = globalThis.crypto?.randomUUID?.() ?? `game-${Date.now()}`;
      const seed = `${gameId}:${selectedTeams.join("-")}`;
      const prepared = prepareUiSession(newEngineSession({ gameId, seed, teamColors: selectedTeams as [TeamColor, TeamColor, TeamColor] }, "PLAYER"));
      setSession(prepared.session);
      setInspection(null);
      setError(prepared.error);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The mission could not be started.");
    }
  };

  const resolveDecision = (optionId: string) => {
    const decision = session?.state.pendingDecision;
    if (!session || !decision) return;
    try {
      const prepared = prepareUiSession(submitSessionDecision(session, decision.id, optionId));
      const selectedOption = decision.legalOptions.find((option) => option.id === optionId);
      const notices = rollNoticesFrom(prepared.session, session.transitions.length, session.state, selectedOption);
      if (notices.length) {
        setPendingRollResolution({ session: prepared.session });
        const preRollAnimation = notices[0]?.preRollAnimation;
        if (preRollAnimation) {
          playBoardAnimation(preRollAnimation, 1000, () => setRollNotices(notices));
        } else setRollNotices(notices);
      } else {
        const runtime = session.state.genestealerAttackRuntime;
        const newTransitions = prepared.session.transitions.slice(session.transitions.length);
        const outcome = runtime && newTransitions.some((transition) => transition.type === "MARINE_SLAIN")
          ? "death"
          : runtime && newTransitions.some((transition) => transition.type === "GENESTEALER_ATTACK_MISSED")
            ? "dodge"
            : null;
        if (runtime && outcome) {
          playBoardAnimation({ marineId: runtime.defenderMarineId, marineAnimation: outcome }, 1400, () => setSession(prepared.session));
        } else setSession(prepared.session);
      }
      setInspection(null);
      setError(prepared.error);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That choice could not be resolved.");
    }
  };

  const undoOne = () => {
    if (!session || !canUndo(session)) return;
    const prepared = prepareUiSession(undo(session));
    setSession(prepared.session);
    setError(prepared.error);
    setInspection(null);
    setRollNotices([]);
    setPendingRollResolution(null);
    clearBoardAnimationTimer();
    setBoardAnimation(null);
  };

  const downloadSave = () => {
    if (!session) return;
    try {
      const blob = new Blob([diagnosticText(session)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `death-angel-${session.state.gameId}-diagnostics.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch { setError("The diagnostic save could not be downloaded."); }
  };

  const startNewMission = () => {
    globalThis.localStorage?.removeItem(SAVED_GAME_KEY);
    setSession(null);
    setInspection(null);
    setSelectedTeams([]);
    setError(null);
    setRollNotices([]);
    setPendingRollResolution(null);
    clearBoardAnimationTimer();
    setBoardAnimation(null);
  };

  if (!restoreComplete) return <main className="restore-shell"><span>Restoring mission state…</span></main>;

  if (!session) {
    return (
      <main className="setup-shell">
        <section className="setup-panel" aria-labelledby="setup-title">
          <div className="brand-lockup"><span className="brand-kicker">Space Hulk</span><h1 id="setup-title">Death Angel</h1><p>Solo mission command</p></div>
          <div className="setup-copy"><span className="section-number">01</span><div><h2>Select three combat teams</h2><p>The formation is randomized after your team choice, just like the physical game.</p></div></div>
          <div className="team-grid">
            {TEAM_COLORS.map((team) => {
              const selected = selectedTeams.includes(team);
              return (
                <button key={team} type="button" className={`team-choice team-${team.toLowerCase()}`} aria-pressed={selected} onClick={() => toggleTeam(team)}>
                  <span className="team-sigil" aria-hidden="true">{selected ? "✓" : "+"}</span>
                  <span><strong>{team}</strong><small>{teamMarineNames(team)}</small></span>
                </button>
              );
            })}
          </div>
          <div className="setup-footer"><span>{selectedTeams.length} / 3 selected</span><button type="button" className="primary-command" disabled={selectedTeams.length !== 3} onClick={startGame}>Begin mission</button></div>
          {error && <p className="error-message" role="alert">{error}</p>}
        </section>
      </main>
    );
  }

  const proceedRoll = () => {
    const notice = rollNotices[0];
    const resolve = pendingRollResolution;
    if (!notice || !resolve) { setRollNotices((current) => current.slice(1)); return; }
    const animation = notice.postRollAnimation;
    const duration = animation?.marineAnimation?.startsWith("gunJam") ? 1800 : 1400;
    if (animation) {
      playBoardAnimation(animation, duration, () => {
        setSession(resolve.session);
        setPendingRollResolution(null);
        setRollNotices([]);
      });
    } else {
      setSession(resolve.session);
      setPendingRollResolution(null);
      setRollNotices([]);
    }
  };

  return <MissionBoard session={session} boardAnimation={boardAnimation} inspection={inspection} error={error} rollNotice={rollNotices[0] ?? null} onDismissRoll={proceedRoll} onInspect={setInspection} onChooseOption={resolveDecision} onUndo={undoOne} onDownloadSave={downloadSave} onDismissInspection={() => setInspection(null)} onNewMission={startNewMission} />;
}

type MissionBoardProps = {
  session: EngineSession;
  boardAnimation: BoardAnimation | null;
  inspection: Inspection | null;
  error: string | null;
  rollNotice: RollNotice | null;
  onInspect: (inspection: Inspection) => void;
  onChooseOption: (optionId: string) => void;
  onUndo: () => void;
  onDownloadSave: () => void;
  onDismissInspection: () => void;
  onDismissRoll: () => void;
  onNewMission: () => void;
};

function MissionBoard({ session, boardAnimation, inspection, error, rollNotice, onInspect, onChooseOption, onUndo, onDownloadSave, onDismissInspection, onDismissRoll, onNewMission }: MissionBoardProps) {
  const [moveSelection, setMoveSelection] = useState<{ decisionId: string; marineId: string } | null>(null);
  const [strategizeSelection, setStrategizeSelection] = useState<{ decisionId: string; swarmId: string } | null>(null);
  const [scoutingPreviewVisible, setScoutingPreviewVisible] = useState(true);
  const [locationCollapsed, setLocationCollapsed] = useState(false);
  const [eventCollapsed, setEventCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { state } = session;
  const decision = state.pendingDecision;
  const selectedMoveMarineId = moveSelection && moveSelection.decisionId === decision?.id ? moveSelection.marineId : null;
  const strategizeSwarms = useMemo(() => strategizeSwarmIds(decision), [decision]);
  const strategizeSwarmSet = useMemo(() => new Set(strategizeSwarms), [strategizeSwarms]);
  const selectedStrategizeSwarmId = strategizeSelection && strategizeSelection.decisionId === decision?.id && strategizeSwarmSet.has(strategizeSelection.swarmId) ? strategizeSelection.swarmId : null;
  const targetIds = useMemo(() => decision?.type === "STRATEGIZE" ? new Set<string>() : pendingTargetIds(decision), [decision]);
  const currentLocation = data.definitions.locations.find((item) => item.id === componentDefinitionId(session, state.currentLocationInstanceId));
  const locationInspection = sourceInspection(session, state.currentLocationInstanceId) ?? { eyebrow: "Setup location", title: setupLocationName(componentDefinitionId(session, state.currentLocationInstanceId)), body: "Starting location for the solo mission.", meta: "Void Lock" };
  const leftBlips = state.orderedSources["blip.left"]?.length ?? 0;
  const rightBlips = state.orderedSources["blip.right"]?.length ?? 0;
  const livingMarines = state.formation.length;
  const undoStatus = getUndoStatus(session);
  const lastEventId = state.eventRuntime?.eventCardId ?? state.orderedSources["event.discard"]?.at(-1) ?? null;
  const lastEvent = lastEventId ? findEvent(lastEventId) : null;
  const formationMarineIds = new Set(state.formation.map((slot) => slot.marineInstanceId));
  const dockOptions = decision?.legalOptions.filter((option) => decision.type === "STRATEGIZE" ? option.payload.skip === true : isOffBoardMarineOption(option, formationMarineIds) || !isDirectInputOption(decision, option)) ?? [];
  const decisionAction = decision ? data.definitions.actions.find((item) => item.id === componentDefinitionId(session, decision.sourceId)) : null;
  const decisionRules = decision?.type === "PLACE_ARTEFACT"
    ? data.definitions.terrain.find((item) => item.id === "terrain.artefact")?.sourceText ?? null
    : null;

  return (
    <main className="mission-shell">
      <section className="lab-hud" aria-label="Mission status">
        <div className="lab-hud-command">
          <div className="live-hud-stats"><span>Marines <b>{livingMarines}/6</b></span><span>Support <b><i>●</i>{state.supportSupply}</b></span></div>
          <div className="lab-hud-cycle"><span>Round</span><strong>{String(state.round).padStart(2, "0")}</strong></div>
          <div className="lab-hud-phase"><span>Current phase</span><strong>{formatPhase(state.phase)}</strong></div>
          <div className="live-hud-menu"><button type="button" aria-label="Open game menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((current) => !current)}>☰</button>{menuOpen && <div className="live-hud-menu-panel"><button type="button" disabled={!undoStatus.allowed} onClick={() => { onUndo(); setMenuOpen(false); }}><strong>↶ Undo</strong><small>{undoStatus.allowed ? `${undoStatus.availableSteps} step${undoStatus.availableSteps === 1 ? "" : "s"} available` : undoStatus.unavailableReason === "RANDOMNESS_BARRIER" ? "Locked by random result" : undoStatus.unavailableReason === "HIDDEN_INFORMATION_BARRIER" ? "Locked by card reveal" : "No reversible step"}</small></button><button type="button" onClick={() => { onDownloadSave(); setMenuOpen(false); }}><strong>⇩ Download save</strong><small>Export this game’s diagnostics</small></button><button type="button" className="is-danger" onClick={() => { if (globalThis.confirm("End this mission and return to team selection?")) { onNewMission(); setMenuOpen(false); } }}><strong>New mission</strong><small>End the current game</small></button></div>}</div>
        </div>

        {locationCollapsed ? (
          <TacticalButton type="button" className="lab-hud-tray lab-location-tray inspectable" onTap={() => setLocationCollapsed(false)} onHold={() => onInspect(locationInspection)} aria-label="Expand current location">
            <span>Location</span><strong>{currentLocation?.name ?? setupLocationName(componentDefinitionId(session, state.currentLocationInstanceId))}</strong><b><i>Left</i>{leftBlips}</b><b><i>Right</i>{rightBlips}</b><em>⌄</em>
          </TacticalButton>
        ) : (
          <div className="lab-location-frame">
            <div className="lab-blip-counter lab-blip-left"><span>Blips</span><strong>{leftBlips}</strong><em>Left</em></div>
            <TacticalButton type="button" className="lab-location-card inspectable" onTap={() => setLocationCollapsed(true)} onHold={() => onInspect(locationInspection)}>
              <span>Current location <b>{currentLocation?.tier ?? "Setup"}</b></span>
              <h2>{currentLocation?.name ?? setupLocationName(componentDefinitionId(session, state.currentLocationInstanceId))}</h2>
              <strong>{locationInspection.meta ?? "Location"}</strong><p>{locationInspection.body}</p><em className="lab-panel-collapse-cue">Tap to minimize ⌃</em><i className="lab-hud-rivet lab-rivet-one" /><i className="lab-hud-rivet lab-rivet-two" />
            </TacticalButton>
            <div className="lab-blip-counter lab-blip-right"><span>Blips</span><strong>{rightBlips}</strong><em>Right</em></div>
          </div>
        )}

        {lastEvent && lastEventId && <TacticalButton type="button" className={`lab-event-card inspectable ${eventCollapsed ? "is-collapsed" : ""}`} onTap={() => setEventCollapsed((current) => !current)} onHold={() => onInspect(sourceInspection(session, lastEventId)!)}>
          <div className="lab-event-heading"><span>{state.phase === "EVENT" ? "Event resolving" : "Current event"}{lastEvent.movement ? <i>{lastEvent.movement}</i> : null}</span><h3>{lastEvent.name}</h3><em className="lab-panel-collapse-cue">Tap to minimize ⌃</em></div>
          <p>{lastEvent.sourceText}</p>
          <div className="lab-event-data" aria-label="Event spawn and movement data">
            {lastEvent.activations.map((activation, index) => <span key={`${activation.terrainColor}.${index}`}><i className={`lab-spawn-dot is-${activation.terrainColor.toLowerCase()}`} />{formatPhase(activation.severity)}</span>)}
            {lastEvent.movementIcon && <span className="lab-icon-readout">{ICON_GLYPHS[lastEvent.movementIcon]} {ICON_LABELS[lastEvent.movementIcon]}</span>}<span className="lab-tray-chevron">{eventCollapsed ? "⌄" : "⌃"}</span>
          </div>
        </TacticalButton>}
      </section>

      <LiveFormationBoard session={session} boardAnimation={boardAnimation} targetIds={targetIds} selectedMoveMarineId={selectedMoveMarineId} selectedStrategizeSwarmId={selectedStrategizeSwarmId} strategizeSwarmIds={strategizeSwarmSet} onChooseOption={onChooseOption} onInspect={onInspect} onSelectMoveMarine={(marineId) => { if (decision) setMoveSelection({ decisionId: decision.id, marineId }); }} onSelectStrategizeSwarm={(swarmId) => { if (decision) setStrategizeSelection({ decisionId: decision.id, swarmId }); }} />

      <LiveActionSelection session={session} onChooseOption={onChooseOption} />

      <section className="command-dock" aria-live="polite">
        {state.activeDie && <DiePanel value={state.activeDie.modifiedValue} skull={state.activeDie.skull} purpose={state.activeDie.purpose} rerolls={state.activeDie.rerolls.length} />}
        {decision ? (
          <div className={`dock-decision ${decisionAction ? `team-context team-${decisionAction.team.toLowerCase()}` : ""}`}>
            <div className="decision-heading"><span>{formatPhase(decision.type)}</span></div>
            {decisionAction && <div className="decision-source"><i />{decisionAction.team} · {decisionAction.name}</div>}
            {decisionRules && <div className="decision-rules"><strong>Artefact ability</strong><span>{decisionRules}</span></div>}
            <p>{decision.promptKey === "event.rescue" ? "Choose a slain Marine below. They will return at the bottom of the formation facing right." : decision.type === "FORWARD_SCOUTING_ORDER" && !scoutingPreviewVisible ? "The event choice is minimized while you inspect the board. Return to Forward Scouting when ready." : decision.type === "STRATEGIZE" && !selectedStrategizeSwarmId ? "Choose a highlighted swarm to move." : decision.type === "STRATEGIZE" ? "Choose a highlighted legal destination, or choose another swarm below." : decision.type === "MOVE_MARINE" && !selectedMoveMarineId ? "Choose a highlighted Marine to move." : decision.type === "MOVE_MARINE" ? "Choose the highlighted destination for that Marine, or select another Marine." : decision.type === "SET_FACING" ? "Choose the left or right tile beside the highlighted Marine—even to keep its current facing." : decision.legalOptions.some((option) => isDirectInputOption(decision, option)) ? "Tap an available card or highlighted board target. Hold any object briefly to read its rules." : "Choose an option below. The formation remains visible while you decide."}</p>
            {decision.type === "STRATEGIZE" && selectedStrategizeSwarmId && <button type="button" className="strategize-reset" onClick={() => setStrategizeSelection(null)}>Choose another swarm</button>}
            {decision.type !== "FORWARD_SCOUTING_ORDER" && dockOptions.length > 0 && <div className="dock-options">{dockOptions.map((option) => { const presentation = presentedDecisionOption(decision, option); return <button key={option.id} type="button" onClick={() => onChooseOption(option.id)}><strong>{presentation.label}</strong>{presentation.preview && <small>{presentation.preview}</small>}</button>; })}</div>}
          </div>
        ) : state.status === "IN_PROGRESS" ? (
          <div className="mission-result engine-paused"><strong>Engine paused</strong><span>Download a save from the game menu before ending this mission.</span></div>
        ) : (
          <div className="mission-result"><strong>{state.status === "VICTORY" ? "Mission accomplished" : "Squad eliminated"}</strong><button type="button" onClick={onNewMission}>Start new mission</button></div>
        )}
        {error && <p className="error-message" role="alert">{error}</p>}
      </section>

      {inspection && <InspectionDrawer inspection={inspection} onClose={onDismissInspection} />}
      {decision?.type === "FORWARD_SCOUTING_ORDER" && (scoutingPreviewVisible
        ? <ForwardScoutingPreview session={session} decision={decision} onChooseOption={onChooseOption} onViewBoard={() => setScoutingPreviewVisible(false)} />
        : <button type="button" className="scouting-return" onClick={() => setScoutingPreviewVisible(true)}><span aria-hidden="true">↩</span><strong>Forward Scouting</strong><small>Return to event choice</small></button>)}
      {rollNotice && <RollResult key={rollNotice.id} notice={rollNotice} onProceed={onDismissRoll} />}
    </main>
  );
}

function labSpawnColor(value: string): "GREEN" | "YELLOW" | "ORANGE" | "RED" {
  return value === "YELLOW" || value === "ORANGE" || value === "RED" ? value : "GREEN";
}

function labRows(session: EngineSession): LabFormationRow[] {
  const { state } = session;
  const flank = (positionIndex: number, side: Side) => {
    const slot = state.formation[positionIndex];
    const terrainId = slot.terrainInstanceIds[side][0];
    const terrainDefinition = terrainId ? data.definitions.terrain.find((item) => item.id === componentDefinitionId(session, terrainId)) : undefined;
    const swarms = slot.swarmIds[side].map((swarmId) => state.swarms[swarmId]).filter((swarm): swarm is NonNullable<typeof swarm> => Boolean(swarm));
    const icons = swarms.flatMap((swarm) => swarm.cardIds.map((cardId) => state.genestealers[cardId]?.icon).filter((icon): icon is GenestealerIcon => Boolean(icon)));
    const broodLords = swarms.reduce((total, swarm) => total + swarm.broodLordIds.length, 0);
    return {
      terrain: terrainDefinition ? { name: terrainDefinition.name, color: labSpawnColor(terrainDefinition.spawnColor) } : undefined,
      swarm: icons.length || broodLords ? { icons, broodLords: broodLords || undefined } : undefined,
    };
  };
  return state.formation.map((slot, positionIndex) => {
    const marineDefinition = data.definitions.marines.find((item) => item.id === componentDefinitionId(session, slot.marineInstanceId));
    const marine = state.marines[slot.marineInstanceId];
    return {
      left: flank(positionIndex, "LEFT"),
      marine: { name: marineDefinition?.name ?? slot.marineInstanceId, team: marineDefinition?.team ?? "GREY", facing: marine?.facing ?? "LEFT", supportTokens: marine?.support ?? 0 },
      right: flank(positionIndex, "RIGHT"),
    };
  });
}

function LiveFormationBoard({ session, boardAnimation, targetIds, selectedMoveMarineId, selectedStrategizeSwarmId, strategizeSwarmIds: selectableStrategizeSwarms, onChooseOption, onInspect, onSelectMoveMarine, onSelectStrategizeSwarm }: { session: EngineSession; boardAnimation: BoardAnimation | null; targetIds: Set<string>; selectedMoveMarineId: string | null; selectedStrategizeSwarmId: string | null; strategizeSwarmIds: Set<string>; onChooseOption: (optionId: string) => void; onInspect: (inspection: Inspection) => void; onSelectMoveMarine: (marineId: string) => void; onSelectStrategizeSwarm: (swarmId: string) => void }) {
  const { state } = session;
  const decision = state.pendingDecision;
  const rows = useMemo(() => labRows(session), [session]);
  const overlayChoices = useMemo<LabOverlayChoice[]>(() => {
    if (!decision) return [];
    if (decision.type === "STRATEGIZE" && selectedStrategizeSwarmId) return decision.legalOptions.flatMap((option) => {
      const row = typeof option.payload.positionIndex === "number" ? option.payload.positionIndex : null;
      const side = option.payload.side === "LEFT" || option.payload.side === "RIGHT" ? option.payload.side : null;
      return row === null || side === null ? [] : [{ label: "Move swarm here", row, side, state: "destination" }];
    });
    if (decision.type === "SET_FACING") return decision.legalOptions.flatMap((option) => {
      const marineId = option.payload.marineId;
      const side = option.payload.facing === "LEFT" || option.payload.facing === "RIGHT" ? option.payload.facing : null;
      const row = typeof marineId === "string" ? state.formation.findIndex((slot) => slot.marineInstanceId === marineId) : -1;
      return row < 0 || side === null ? [] : [{ label: `Face ${side.toLowerCase()}`, row, side, state: "destination" }];
    });
    return [];
  }, [decision, selectedStrategizeSwarmId, state.formation]);
  const marineMoveChoices = useMemo(() => decision?.type === "MOVE_MARINE" && selectedMoveMarineId
    ? decision.legalOptions.flatMap((option) => typeof option.payload.to === "number" && option.payload.marineId === selectedMoveMarineId ? [{ row: option.payload.to, label: "Swap positions" }] : [])
    : [], [decision, selectedMoveMarineId]);
  const marineStates = useMemo<Record<string, LabTargetState>>(() => Object.fromEntries(state.formation.map((slot, positionIndex) => {
    const marineId = slot.marineInstanceId;
    const name = rows[positionIndex].marine.name;
    const selectable = decision?.type === "MOVE_MARINE" && decision.legalOptions.some((option) => option.payload.marineId === marineId);
    const targeted = decision?.type !== "MOVE_MARINE" && targetIds.has(marineId);
    return [name, selectedMoveMarineId === marineId ? "selected" : selectable ? "selectable" : targeted ? "targeted" : "neutral"];
  })), [decision, rows, selectedMoveMarineId, state.formation, targetIds]);
  const swarmStates = useMemo<Record<string, LabTargetState>>(() => Object.fromEntries(state.formation.flatMap((slot, positionIndex) => (["LEFT", "RIGHT"] as const).map((side) => {
    const swarmId = slot.swarmIds[side][0];
    const selectable = decision?.type === "STRATEGIZE" && !selectedStrategizeSwarmId && Boolean(swarmId && selectableStrategizeSwarms.has(swarmId));
    const selected = Boolean(swarmId && selectedStrategizeSwarmId === swarmId);
    const targeted = Boolean(swarmId && targetIds.has(swarmId));
    return [cellKey(positionIndex, side), selected ? "selected" : selectable ? "selectable" : targeted ? "targeted" : "neutral"];
  }))), [decision, selectedStrategizeSwarmId, selectableStrategizeSwarms, state.formation, targetIds]);
  const terrainStates = useMemo<Record<string, LabTargetState>>(() => Object.fromEntries(state.formation.flatMap((slot, positionIndex) => (["LEFT", "RIGHT"] as const).map((side) => {
    const terrainId = slot.terrainInstanceIds[side][0];
    return [cellKey(positionIndex, side), terrainId && targetIds.has(terrainId) ? "targeted" : "neutral"];
  }))), [state.formation, targetIds]);
  const marineAnimationStates = useMemo(() => {
    const marineId = boardAnimation?.marineId;
    const animation = boardAnimation?.marineAnimation;
    if (!marineId || !animation) return {};
    const definition = data.definitions.marines.find((item) => item.id === componentDefinitionId(session, marineId));
    return definition ? { [definition.name]: animation } : {};
  }, [boardAnimation, session]);
  const swarmAnimationStates = useMemo(() => {
    const swarmId = boardAnimation?.swarmId;
    if (!swarmId || !boardAnimation?.swarmAnimation) return {};
    const swarm = state.swarms[swarmId];
    return swarm ? { [cellKey(swarm.positionIndex, swarm.side)]: boardAnimation.swarmAnimation } : {};
  }, [boardAnimation, state.swarms]);
  const chooseCellOption = (row: number, side: Side) => {
    if (!decision) return;
    const option = decision.type === "STRATEGIZE" && selectedStrategizeSwarmId
      ? strategizeDestinationOption(decision, selectedStrategizeSwarmId, row, side)
      : decision.type === "SET_FACING"
        ? decision.legalOptions.find((item) => item.payload.marineId === state.formation[row].marineInstanceId && item.payload.facing === side) ?? null
        : uniquePayloadOption(decision, "positionIndex", row, side);
    if (option) onChooseOption(option.id);
  };
  const chooseSwarm = (row: number, side: Side) => {
    const swarmId = state.formation[row].swarmIds[side][0];
    if (!decision || !swarmId) return;
    if (decision.type === "STRATEGIZE" && !selectedStrategizeSwarmId && selectableStrategizeSwarms.has(swarmId)) { onSelectStrategizeSwarm(swarmId); return; }
    const option = uniquePayloadOption(decision, "swarmId", swarmId);
    if (option) onChooseOption(option.id);
  };
  const chooseMarine = (name: string) => {
    const row = rows.findIndex((item) => item.marine.name === name);
    const marineId = row >= 0 ? state.formation[row].marineInstanceId : null;
    if (!decision || !marineId) return;
    if (decision.type === "MOVE_MARINE" && decision.legalOptions.some((option) => option.payload.marineId === marineId)) { onSelectMoveMarine(marineId); return; }
    const option = uniquePayloadOption(decision, "marineId", marineId);
    if (option) onChooseOption(option.id);
  };
  const chooseTerrain = (row: number, side: Side) => {
    const terrainId = state.formation[row].terrainInstanceIds[side][0];
    const option = terrainId ? uniquePayloadOption(decision, "terrainId", terrainId) : null;
    if (option) onChooseOption(option.id);
  };
  const liveStyle = { "--lab-scale": "1", "--lab-viewport": "1180px" } as CSSProperties;
  return <section className="live-sprite-board" style={liveStyle}><FormationBoard rows={rows} marineSpriteUrl="prototype-art/marine-idle.gif" marineDeathStripUrl="game-art/marine/death.png" marineDodgeStripUrl="game-art/marine/dodge.png" marineFireStripUrls={{ straight: "game-art/marine/fire-straight.png", up: "game-art/marine/fire-up.png", down: "game-art/marine/fire-down.png" }} marineJamStripUrls={{ straight: "game-art/marine/gun-jam-straight.png", up: "game-art/marine/gun-jam-up.png", down: "game-art/marine/gun-jam-down.png" }} alienSpriteUrl="prototype-art/alien-attack.gif" alienAttackStripUrl="game-art/genestealer/attack.png" alienDeathStripUrl="game-art/genestealer/death.png" alienIdleStripUrl="game-art/genestealer/idle.png" broodlordSpriteUrl="game-art/broodlord/idle.png" marineAnimationStates={marineAnimationStates} swarmAnimationStates={swarmAnimationStates} marineStates={marineStates} marineMoveChoices={marineMoveChoices} overlayChoices={overlayChoices} swarmStates={swarmStates} terrainStates={terrainStates} selectedMarine={null} onSelectMarine={chooseMarine} onSelectSwarm={chooseSwarm} onSelectTerrain={chooseTerrain} onOverlayChoice={(choice) => chooseCellOption(choice.row, choice.side)} onMarineMoveChoice={(choice) => { const option = decision?.legalOptions.find((item) => item.payload.marineId === selectedMoveMarineId && item.payload.to === choice.row); if (option) onChooseOption(option.id); }} onInspect={(details) => onInspect({ eyebrow: details.eyebrow, title: details.title, body: details.body, meta: details.subtitle })} /></section>;
}

// Kept as a reference while the remaining card-level target choices are moved to the sprite board.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function FormationRow({ session, positionIndex, targetIds, selectedMoveMarineId, strategizeSwarmIds: selectableStrategizeSwarms, selectedStrategizeSwarmId, onSelectMoveMarine, onSelectStrategizeSwarm, onInspect, onChooseOption }: { session: EngineSession; positionIndex: number; targetIds: Set<string>; selectedMoveMarineId: string | null; strategizeSwarmIds: Set<string>; selectedStrategizeSwarmId: string | null; onSelectMoveMarine: (marineId: string) => void; onSelectStrategizeSwarm: (swarmId: string) => void; onInspect: (inspection: Inspection) => void; onChooseOption: (optionId: string) => void }) {
  const { state } = session;
  const decision = state.pendingDecision;
  const slot = state.formation[positionIndex];
  const marine = state.marines[slot.marineInstanceId];
  const marineDefinition = data.definitions.marines.find((item) => item.id === componentDefinitionId(session, slot.marineInstanceId))!;
  const moveMarineAvailable = decision?.type === "MOVE_MARINE" && decision.legalOptions.some((option) => option.payload.marineId === slot.marineInstanceId);
  const marineOption = decision?.type === "MOVE_MARINE" ? null : uniquePayloadOption(decision, "marineId", slot.marineInstanceId);
  const moveDestination = decision?.type === "MOVE_MARINE" && selectedMoveMarineId
    ? decision.legalOptions.find((option) => option.payload.marineId === selectedMoveMarineId && option.payload.to === positionIndex) ?? null
    : null;
  const rowOption = moveDestination ?? (decision?.type === "STRATEGIZE" ? null : uniquePayloadOption(decision, "positionIndex", positionIndex));
  const tapOption = marineOption ?? rowOption;
  return (
    <div className={`formation-row ${moveDestination || (decision?.type !== "MOVE_MARINE" && targetIds.has(`position:${positionIndex}`)) ? "legal-row" : ""}`}>
      <Flank session={session} positionIndex={positionIndex} side="LEFT" strategizeSwarmIds={selectableStrategizeSwarms} selectedStrategizeSwarmId={selectedStrategizeSwarmId} onSelectStrategizeSwarm={onSelectStrategizeSwarm} onInspect={onInspect} onChooseOption={onChooseOption} />
      <TacticalButton type="button" className={`marine-card inspectable team-${marineDefinition.team.toLowerCase()} ${tapOption || moveMarineAvailable ? "legal-target" : ""} ${selectedMoveMarineId === slot.marineInstanceId ? "is-move-selected" : ""}`} onTap={tapOption ? () => onChooseOption(tapOption.id) : moveMarineAvailable ? () => onSelectMoveMarine(slot.marineInstanceId) : undefined} onHold={() => onInspect(sourceInspection(session, slot.marineInstanceId)!)}>
        <span className="marine-facing" aria-label={`Facing ${marine.facing}`}>{marine.facing === "LEFT" ? "◀" : "▶"}</span>
        {marineDefinition.namedActionAbility && <span className="marine-ability" aria-label={`Special ability: ${marineDefinition.namedActionAbility}`}>★</span>}
        <strong>{marineDefinition.name}</strong>
        <span className="marine-stats"><b>◎ Range {marineDefinition.attackRange}</b><i>{marine.support ? `${"●".repeat(marine.support)} support tokens` : "No support tokens"}</i></span>
      </TacticalButton>
      <Flank session={session} positionIndex={positionIndex} side="RIGHT" strategizeSwarmIds={selectableStrategizeSwarms} selectedStrategizeSwarmId={selectedStrategizeSwarmId} onSelectStrategizeSwarm={onSelectStrategizeSwarm} onInspect={onInspect} onChooseOption={onChooseOption} />
    </div>
  );
}

function Flank({ session, positionIndex, side, strategizeSwarmIds: selectableStrategizeSwarms, selectedStrategizeSwarmId, onSelectStrategizeSwarm, onInspect, onChooseOption }: { session: EngineSession; positionIndex: number; side: Side; strategizeSwarmIds: Set<string>; selectedStrategizeSwarmId: string | null; onSelectStrategizeSwarm: (swarmId: string) => void; onInspect: (inspection: Inspection) => void; onChooseOption: (optionId: string) => void }) {
  const slot = session.state.formation[positionIndex];
  const decision = session.state.pendingDecision;
  const terrainIds = slot.terrainInstanceIds[side];
  const swarmIds = slot.swarmIds[side];
  const facingOption = decision?.type === "SET_FACING"
    ? decision.legalOptions.find((option) => option.payload.marineId === slot.marineInstanceId && option.payload.facing === side) ?? null
    : null;
  const strategizeDestination = strategizeDestinationOption(decision, selectedStrategizeSwarmId, positionIndex, side);
  const positionOption = strategizeDestination ?? facingOption ?? (decision?.type === "STRATEGIZE" ? null : uniquePayloadOption(decision, "positionIndex", positionIndex, side));
  return (
    <div className={`flank-cell ${positionOption ? "legal-target" : ""} ${facingOption ? "facing-choice" : ""}`}>
      {positionOption && <button type="button" className="flank-position-input" aria-label={facingOption ? `Face ${side.toLowerCase()}` : `Choose formation position ${positionIndex + 1}, ${side.toLowerCase()} side`} onClick={() => onChooseOption(positionOption.id)}>{facingOption && <span>{side === "LEFT" ? "◀" : "▶"}<small>Face {side.toLowerCase()}</small></span>}</button>}
      <div className="terrain-stack">
        {terrainIds.map((terrainId) => {
          const terrain = data.definitions.terrain.find((item) => item.id === componentDefinitionId(session, terrainId));
          if (!terrain) return null;
          const option = uniquePayloadOption(decision, "terrainId", terrainId);
          return <TacticalButton key={terrainId} type="button" className={`terrain-chip inspectable ${option ? "legal-target" : ""}`} onTap={option ? () => onChooseOption(option.id) : undefined} onHold={() => onInspect(sourceInspection(session, terrainId)!)} stopPropagation><span><i className={`spawn-dot spawn-${terrain.spawnColor.toLowerCase()}`} />{terrain.name}</span><em>ⓘ</em>{session.state.terrain[terrainId]?.support > 0 && <b>{"●".repeat(session.state.terrain[terrainId].support)}</b>}</TacticalButton>;
        })}
      </div>
      <div className="swarm-stack">
        {swarmIds.map((swarmId) => {
          const swarm = session.state.swarms[swarmId];
          if (!swarm) return null;
          const strategizeSelectable = decision?.type === "STRATEGIZE" && !selectedStrategizeSwarmId && selectableStrategizeSwarms.has(swarmId);
          const strategizeSelected = selectedStrategizeSwarmId === swarmId;
          return (
            <div key={swarmId} className={`swarm-group ${strategizeSelectable ? "strategize-selectable" : ""} ${strategizeSelected ? "strategize-selected" : ""}`}>
              {strategizeSelectable && <button type="button" className="swarm-select-input" aria-label={`Select swarm at formation position ${positionIndex + 1}, ${side.toLowerCase()} side`} onClick={() => onSelectStrategizeSwarm(swarmId)} />}
              {swarm.cardIds.map((cardId) => {
                const icon = session.state.genestealers[cardId].icon;
                const option = decision?.type === "STRATEGIZE" ? null : uniquePayloadOption(decision, "cardId", cardId) ?? uniquePayloadOption(decision, "swarmId", swarmId);
                return <TacticalButton key={cardId} type="button" className={`genestealer-icon ${option ? "legal-target" : ""}`} aria-label={`${ICON_LABELS[icon]} Genestealer. Hold to inspect.`} onTap={option ? () => onChooseOption(option.id) : undefined} onHold={() => onInspect({ eyebrow: `Genestealer · ${side.toLowerCase()} swarm`, title: ICON_LABELS[icon], body: `A ${ICON_LABELS[icon].toLowerCase()} Genestealer in a swarm of ${swarm.cardIds.length + swarm.broodLordIds.length}.`, meta: `Formation position ${positionIndex + 1}${session.state.genestealers[cardId].movedOrFlankedThisEvent ? " · moved this event" : ""}` })} stopPropagation><span>{ICON_GLYPHS[icon]}</span><small>{ICON_LABELS[icon]}</small></TacticalButton>;
              })}
              {swarm.broodLordIds.map((broodLordId) => {
                const option = decision?.type === "STRATEGIZE" ? null : uniquePayloadOption(decision, "cardId", broodLordId) ?? uniquePayloadOption(decision, "swarmId", swarmId);
                return <TacticalButton key={broodLordId} type="button" className={`genestealer-icon brood-lord ${option ? "legal-target" : ""}`} onTap={option ? () => onChooseOption(option.id) : undefined} onHold={() => onInspect({ eyebrow: "Brood Lord", title: "Brood Lord", body: "A Brood Lord counts as multiple Genestealers when attacking and follows its current movement icons.", meta: `Formation position ${positionIndex + 1}` })} stopPropagation><span>♛</span><small>Lord</small></TacticalButton>;
              })}
            </div>
          );
        })}
      </div>
      {!terrainIds.length && !swarmIds.length && <span className="clear-lane">Clear</span>}
    </div>
  );
}

function DiePanel({ value, skull, purpose, rerolls }: { value: number; skull: boolean; purpose: string; rerolls: number }) {
  return <section className="die-panel"><div className="die-face"><strong>{value}</strong>{skull && <span>☠︎</span>}</div><div><span>Combat die</span><strong>{formatPhase(purpose)}</strong><small>{rerolls ? `${rerolls} reroll${rerolls === 1 ? "" : "s"}` : "Initial result"}</small></div></section>;
}

function InspectionDrawer({ inspection, onClose }: { inspection: Inspection; onClose: () => void }) {
  return (
    <div className="inspection-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="inspection-drawer" role="dialog" aria-modal="true" aria-labelledby="inspection-title">
        <div className="inspection-handle" aria-hidden="true" />
        <button type="button" className="inspection-close" onClick={onClose} aria-label="Close card details">×</button>
        <span className="inspection-eyebrow">{inspection.eyebrow}</span><h2 id="inspection-title">{inspection.title}</h2>{inspection.meta && <p className="inspection-meta">{inspection.meta}</p>}<p className="inspection-body">{inspection.body}</p>
      </aside>
    </div>
  );
}

function ForwardScoutingPreview({ session, decision, onChooseOption, onViewBoard }: { session: EngineSession; decision: PendingDecision; onChooseOption: (optionId: string) => void; onViewBoard: () => void }) {
  const eventCardId = decision.legalOptions.map((option) => option.payload.eventCardId).find((value): value is string => typeof value === "string");
  const event = eventCardId ? findEvent(componentDefinitionId(session, eventCardId)) : null;
  if (!event) return null;

  return (
    <div className="scouting-backdrop" role="presentation">
      <section className="scouting-preview" role="dialog" aria-modal="true" aria-labelledby="scouting-title">
        <header><span>Purple team · Forward Scouting</span><h2 id="scouting-title">{event.name}</h2>{event.copyIndex && <small>Event copy {event.copyIndex}</small>}<button type="button" className="scouting-board-toggle" onClick={onViewBoard} aria-label="View formation board" title="View formation board">▦</button></header>
        <div className="scouting-rules"><span>Event effect</span><p>{event.sourceText}</p></div>
        <dl className="scouting-data">
          {event.activations.map((activation, index) => (
            <div key={`${activation.terrainColor}.${index}`}><dt>Spawn {index + 1}</dt><dd><i className={`spawn-dot spawn-${activation.terrainColor.toLowerCase()}`} />{formatPhase(activation.severity)} · {formatPhase(activation.terrainColor)}</dd></div>
          ))}
          <div><dt>Movement icon</dt><dd>{event.movementIcon ? <><b>{ICON_GLYPHS[event.movementIcon]}</b>{ICON_LABELS[event.movementIcon]}</> : "None"}</dd></div>
          <div><dt>Movement</dt><dd>{event.movement ? formatPhase(event.movement) : "None"}</dd></div>
        </dl>
        <div className="scouting-actions">
          <span>Choose where to return this event</span>
          {decision.legalOptions.map((option) => <button key={option.id} type="button" onClick={() => onChooseOption(option.id)}><strong>{option.label}</strong>{option.canonicalEffectPreview && <small>{option.canonicalEffectPreview}</small>}</button>)}
        </div>
      </section>
    </div>
  );
}

function RollResult({ notice, onProceed }: { notice: RollNotice; onProceed: () => void }) {
  const finalFace = combatDieFace(notice.value);
  const landing = useMemo(() => rollLanding(notice.id), [notice.id]);
  const landingStyle = {
    "--die-x": `${landing.x}%`,
    "--die-y": `${landing.y}%`,
    "--die-start-x": landing.startX,
    "--die-start-y": landing.startY,
    "--die-mid-one-x": landing.midOneX,
    "--die-mid-one-y": landing.midOneY,
    "--die-mid-two-x": landing.midTwoX,
    "--die-mid-two-y": landing.midTwoY,
    "--die-bounce-x": landing.bounceX,
    "--die-bounce-y": landing.bounceY,
    "--die-spin-start": landing.spinStart,
    "--die-spin-mid-one": landing.spinMidOne,
    "--die-spin-mid-two": landing.spinMidTwo,
    "--die-spin-bounce": landing.spinBounce,
  } as CSSProperties;
  const reduceMotion = useMemo(() => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false, []);
  const rollInterval = useRef<ReturnType<typeof globalThis.setInterval> | null>(null);
  const settleTimer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const [rolling, setRolling] = useState(!reduceMotion);
  const [displayValue, setDisplayValue] = useState<CombatDieValue>(reduceMotion ? finalFace.value : 0);
  const displayFace = combatDieFace(displayValue);

  const clearRollTimers = () => {
    if (rollInterval.current !== null) globalThis.clearInterval(rollInterval.current);
    if (settleTimer.current !== null) globalThis.clearTimeout(settleTimer.current);
    rollInterval.current = null;
    settleTimer.current = null;
  };

  const settleRoll = () => {
    clearRollTimers();
    setDisplayValue(finalFace.value);
    setRolling(false);
  };

  useEffect(() => {
    const clearTimers = () => {
      if (rollInterval.current !== null) globalThis.clearInterval(rollInterval.current);
      if (settleTimer.current !== null) globalThis.clearTimeout(settleTimer.current);
      rollInterval.current = null;
      settleTimer.current = null;
    };
    if (reduceMotion) return clearTimers;

    let frame = 0;
    rollInterval.current = globalThis.setInterval(() => {
      frame = (frame + 1) % COMBAT_DIE_FACES.length;
      setDisplayValue(COMBAT_DIE_FACES[frame].value);
    }, 110);
    settleTimer.current = globalThis.setTimeout(() => {
      clearTimers();
      setDisplayValue(finalFace.value);
      setRolling(false);
    }, 1680);
    return clearTimers;
  }, [finalFace.value, reduceMotion]);

  return (
    <div className="roll-backdrop" role="presentation">
      <section className={`roll-result ${rolling ? "is-rolling" : "is-settled"}`} role="dialog" aria-modal="true" aria-labelledby="roll-title">
        <span>{notice.reroll ? "Die rerolled" : "Die rolled"}</span>
        <h2 id="roll-title">{notice.title}</h2>
        <div className="roll-stage" style={landingStyle} aria-live="polite">
          <div className="roll-face" data-rolling={rolling || undefined} data-skull={displayFace.skull || undefined} aria-label={rolling ? "Combat die rolling" : `Combat die result ${finalFace.value}${finalFace.skull ? ", skull" : ""}`}>
            <strong>{displayFace.value}</strong>{displayFace.skull && <i aria-hidden="true">☠︎</i>}
          </div>
        </div>
        <p>{rolling ? "Rolling…" : finalFace.skull ? `${finalFace.value} · Skull result` : `Result: ${finalFace.value}`}</p>
        <button type="button" onClick={rolling ? settleRoll : onProceed}>{rolling ? "Skip roll" : "Proceed"}</button>
      </section>
    </div>
  );
}
