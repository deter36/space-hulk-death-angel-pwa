"use client";

import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
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
import { combatDieFace } from "@/src/ui-adapter/combat-die";
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
type HoverInspection = Inspection & { anchor: { top: number; bottom: number; left: number; right: number } };

type RollNotice = {
  postRollAnimation: BoardAnimation | null;
  outcome: string;
  placement: "top" | "bottom";
  id: string;
  value: number;
  skull: boolean;
  title: string;
  reroll: boolean;
  transitionSeq: number;
};

type PlayMode = "STANDARD" | "TUTORIAL";

type BoardAnimation = {
  marineAnimation?: "death" | "dodge" | "fire-straight" | "fire-up" | "fire-down" | "gunJam-straight" | "gunJam-up" | "gunJam-down";
  marineId?: string;
  swarmAnimation?: "attack" | "death";
  swarmId?: string;
  movingSwarmCells?: Record<string, "up" | "down" | "flank">;
};

type DesktopBoardScale = "AUTO" | "COMPACT" | "STANDARD" | "LARGE";
const DESKTOP_BOARD_SCALE_KEY = "death-angel.desktop-board-scale";
const APP_VERSION = "0.1.0";

function useBoardScale(desktopPreference: DesktopBoardScale): number {
  const [scale, setScale] = useState(0.84);
  useEffect(() => {
    const update = () => {
    const viewportHeight = globalThis.visualViewport?.height ?? globalThis.innerHeight;
    const viewportWidth = globalThis.visualViewport?.width ?? globalThis.innerWidth;
    if (viewportWidth > 700) {
      const automatic = Math.max(1.08, Math.min(1.35, (viewportHeight - 205) / 610));
      setScale(desktopPreference === "COMPACT" ? 1 : desktopPreference === "STANDARD" ? 1.2 : desktopPreference === "LARGE" ? 1.45 : automatic);
      return;
    }
    // The live board receives the space left by the HUD and card tray. This
    // conservative allowance keeps the six-lane board inside short mobile
    // viewports without stretching any individual asset.
    const heightScale = (viewportHeight - 225) / 650;
    const widthScale = viewportWidth / 390;
    setScale(Math.max(0.62, Math.min(1, heightScale, widthScale)));
  };
    update();
    globalThis.addEventListener("resize", update);
    globalThis.visualViewport?.addEventListener("resize", update);
    return () => {
      globalThis.removeEventListener("resize", update);
      globalThis.visualViewport?.removeEventListener("resize", update);
    };
  }, [desktopPreference]);
  return scale;
}

type PendingRollResolution = { session: EngineSession };
type ResolutionNotice = { id: string; eyebrow: string; title: string; body: string; meta?: string; team?: TeamColor; presentation?: "modal" | "board" | "movement"; terrainIds?: string[] };
type MovementPresentation = { id: string; sourceSession: EngineSession; resolvedSession: EngineSession; animation: BoardAnimation };
type TravelStage = "retreat" | "crossfade" | "arrive";

function isRollFollowUp(decision: PendingDecision | null): decision is PendingDecision {
  return Boolean(decision && ["ATTACK_REROLL", "DEFENSE_REROLL", "EVENT_ATTACK_REROLL"].includes(decision.type));
}

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

function actionCardSummary(type: string): string {
  if (type === "SUPPORT") return "Place support";
  if (type === "MOVE_ACTIVATE") return "Move + Activate";
  return "Attack";
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
  return data.definitions.marines.filter((marine) => marine.team === team).map((marine) => shortMarineName(marine.name)).join(" · ");
}

function shortMarineName(name: string): string {
  return name.trim().split(/\s+/).at(-1) ?? name;
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
    return { eyebrow: `${marine.team} combat team`, title: shortMarineName(marine.name), body: namedAction ? `${namedAction.name}: ${namedAction.sourceText}` : "No named Action-card ability.", meta: `Attack range ${marine.attackRange}` };
  }
  const location = data.definitions.locations.find((item) => item.id === definitionId);
  if (location) return { eyebrow: `Location ${location.tier}`, title: location.name, body: location.sourceText ?? "No special Location ability.", meta: `Blips: ${location.leftBlips} left · ${location.rightBlips} right${location.abilityTiming ? ` · ${location.abilityTiming}` : ""}` };
  const event = findEvent(sourceId);
  if (event) return { eyebrow: event.copyIndex ? `Event · copy ${event.copyIndex}` : "Event", title: event.name, body: event.sourceText, meta: event.movementIcon ? `${ICON_LABELS[event.movementIcon]} · ${event.movement ?? "movement"}` : undefined };
  return null;
}

type TutorialActionGuide = { type: string; allowedActionIds: Set<string>; label: string; body: string };

function tutorialActionGuide(session: EngineSession): TutorialActionGuide | null {
  const decision = session.state.pendingDecision;
  if (session.state.round !== 1 || decision?.type !== "CHOOSE_ACTION") return null;
  const chosenTypes = new Set(session.state.activeTeams.map((team) => {
    const chosenId = session.state.teams[team].chosenActionInstanceId;
    return chosenId ? data.definitions.actions.find((action) => action.id === componentDefinitionId(session, chosenId))?.type : null;
  }).filter((type): type is string => Boolean(type)));
  const nextType = ["SUPPORT", "MOVE_ACTIVATE", "ATTACK"].find((type) => !chosenTypes.has(type));
  if (!nextType) return null;
  const allowedActionIds = new Set(decision.legalOptions
    .map((option) => typeof option.payload.actionId === "string" ? option.payload.actionId : null)
    .filter((actionId): actionId is string => Boolean(actionId))
    .filter((actionId) => data.definitions.actions.find((action) => action.id === componentDefinitionId(session, actionId))?.type === nextType));
  const copy = nextType === "SUPPORT"
    ? { label: "Support", body: "Choose a Support card first. Its action will place a green Support token on a Marine, ready to power a reroll or ability." }
    : nextType === "MOVE_ACTIVATE"
      ? { label: "Move + Activate", body: "Now choose Move + Activate. You will reposition a Marine, then activate Terrain or place a Support token." }
      : { label: "Attack", body: "Finish the command with Attack. Range determines which opposing swarms that squad can target." };
  return { type: nextType, allowedActionIds, ...copy };
}

function tutorialGuidance(session: EngineSession): { eyebrow: string; title: string; body: string } {
  const decision = session.state.pendingDecision;
  const round = session.state.round;
  const chapter = round === 1 ? "Round 1 · Guided" : round === 2 ? "Round 2 · Coached" : "Round 3 · Open play";
  const actionGuide = tutorialActionGuide(session);
  if (round === 1 && actionGuide) return { eyebrow: chapter, title: `Choose ${actionGuide.label}`, body: actionGuide.body };
  if (round === 1 && decision?.type === "SUPPORT_TOKEN_TARGET") return { eyebrow: chapter, title: "Place a Support token", body: "Choose the highlighted Marine. Support is shown as the green dots beside a Marine and can be spent for rerolls or card abilities." };
  if (round === 1 && decision?.type === "MOVE_MARINE") return { eyebrow: chapter, title: "Reposition the formation", body: "Select the highlighted Marine, then the highlighted destination. Marines can swap places so range and terrain line up." };
  if (round === 1 && decision?.type === "ACTIVATE_TERRAIN") return { eyebrow: chapter, title: "Activate Terrain", body: "Terrain lives behind a swarm. Select a glowing piece to use its effect; the colored halo marks its blip-spawn color." };
  if (round === 1 && decision?.type === "ATTACK_MARINE") return { eyebrow: chapter, title: "Choose an attacker", body: "Tap a highlighted Marine, then choose a highlighted swarm in range. The die will determine whether the attack hits." };
  if (round === 1 && decision?.type === "ATTACK_TARGET") return { eyebrow: chapter, title: "Choose a target swarm", body: "Only highlighted swarms are legal targets. Tap one to make the attack." };
  if (round === 1 && decision?.type === "ATTACK_SLAY") return { eyebrow: chapter, title: "Confirm the kill", body: "A successful attack can now remove one Genestealer from the chosen swarm. The swarm count updates after the death animation." };
  if (round === 1 && decision?.type === "GENESTEALER_ATTACK_ACK") return { eyebrow: chapter, title: "Defend the formation", body: "This swarm attacks its paired Marine. Proceed to roll, then watch the dodge or death result." };
  if (round === 1 && session.state.phase === "EVENT") return { eyebrow: chapter, title: "Resolve the Event", body: "Read the entire card first. Effects, spawning, and Genestealer movement all resolve in sequence." };
  if (round === 2) return { eyebrow: chapter, title: "Choose with a little coaching", body: "You have full control this round. Check card text, range, support tokens, and terrain before committing an action." };
  return { eyebrow: chapter, title: "Command the strike force", body: "Play freely. When the squad reaches a travel opportunity, the tutorial will call out how location travel changes the board." };
}

function TutorialCoach({ session }: { session: EngineSession }) {
  const guidance = tutorialGuidance(session);
  return <aside className="tutorial-coach" aria-live="polite"><span>{guidance.eyebrow}</span><strong>{guidance.title}</strong><p>{guidance.body}</p></aside>;
}

type TutorialTarget = "stats" | "round" | "phase" | "mission" | "board" | "cards";
const TUTORIAL_HUD_TOUR: Array<{ target: TutorialTarget; title: string; body: string }> = [
  { target: "stats", title: "Your strike force", body: "This shows Marines still alive and unspent Support tokens. Support helps power abilities and rerolls." },
  { target: "round", title: "Round counter", body: "Each round begins with choosing one action card for every active squad." },
  { target: "phase", title: "Current phase", body: "This tells you exactly where the round is: actions, Genestealer attacks, or the Event." },
  { target: "mission", title: "Mission tray", body: "Tap this tray for the current Location, Event, and both Blip piles. Hold cards and board pieces anytime to read their details." },
  { target: "board", title: "The formation", body: "Marines hold the center. Genestealers engage from either flank, while Terrain sits behind each swarm." },
  { target: "cards", title: "Command rail", body: "Choose your squad actions here. During resolution, swipe between your selected cards and the current instruction." },
];

function TutorialHudTour({ step, onAdvance, onSkip }: { step: number; onAdvance: () => void; onSkip: () => void }) {
  const current = TUTORIAL_HUD_TOUR[step];
  if (!current) return null;
  const lastStep = step === TUTORIAL_HUD_TOUR.length - 1;
  return <div className={`tutorial-tour is-${current.target}`} role="dialog" aria-modal="true" aria-labelledby="tutorial-tour-title">
    <section className="tutorial-tour-card"><span>Guided tutorial · {step + 1}/{TUTORIAL_HUD_TOUR.length}</span><h2 id="tutorial-tour-title">{current.title}</h2><p>{current.body}</p><footer><button type="button" className="tutorial-tour-skip" onClick={onSkip}>Skip tour</button><button type="button" className="tutorial-tour-next" onClick={onAdvance}>{lastStep ? "Start command" : "Next"}</button></footer></section>
  </div>;
}

function marineDisplayName(session: EngineSession, marineId: string | undefined): string {
  if (!marineId) return "The selected Space Marine";
  const marine = data.definitions.marines.find((item) => item.id === componentDefinitionId(session, marineId));
  return marine ? shortMarineName(marine.name) : "The selected Space Marine";
}

function decisionInstruction(session: EngineSession, decision: PendingDecision, selectedMoveMarineId: string | null, selectedStrategizeSwarmId: string | null, scoutingPreviewVisible: boolean): string | null {
  if (decision.promptKey === "event.rescue") return "Choose a slain Marine.";
  if (decision.type === "FORWARD_SCOUTING_ORDER" && !scoutingPreviewVisible) return "The event choice is minimized while you inspect the board. Return to Forward Scouting when ready.";
  if (decision.type === "ATTACK_MARINE") return "Choose a highlighted Marine.";
  if (decision.type === "ATTACK_TARGET") {
    return `Choose a highlighted Genestealer target.`;
  }
  if (decision.type === "ACTIVATE_TERRAIN") return "Choose highlighted Terrain to activate.";
  if (decision.type === "PLACE_SUPPORT") return "Choose a highlighted Marine for Support.";
  if (decision.type === "COUNTER_ATTACK_SLAY") return "Choose the attacking Genestealer to slay.";
  if (decision.type === "DOOR_TRAVEL_SLAY") return "Choose a highlighted swarm to slay with Door support.";
  if (decision.type === "TRAVEL_ANIMATION_ACK" || decision.type === "LOCATION_ARRIVAL_ACK") return null;
  if (decision.type === "ATTACK_SLAY" && session.state.actionStep === "HEROIC_CHARGE_SLAY") return "Choose a highlighted swarm to slay.";
  if (decision.type === "INTIMIDATION_PICK") return "Choose a highlighted swarm to return to a Blip pile.";
  if (decision.type === "EVENT_SLAY") return decision.legalOptions[0]?.payload.purpose === "for-my-battle-brothers"
    ? "Choose a highlighted engaged swarm to slay."
    : "Choose a highlighted swarm to slay.";
  if (decision.type === "PLACE_ARTEFACT") return "Choose a highlighted empty flank.";
  if (decision.type === "GENESTEALER_ATTACK_ACK") {
    return null;
  }
  if (decision.type === "EVENT_MOVEMENT_ACK") return null;
  if (decision.type === "STRATEGIZE" && !selectedStrategizeSwarmId) return "Choose a highlighted swarm to move.";
  if (decision.type === "STRATEGIZE") return "Choose a highlighted destination.";
  if (decision.type === "MOVE_MARINE" && !selectedMoveMarineId) return "Choose a highlighted Marine to move.";
  if (decision.type === "MOVE_MARINE") return "Choose a highlighted destination.";
  if (decision.type === "SET_FACING") return "Choose a side for the highlighted Marine.";
  if (decision.legalOptions.some((option) => isDirectInputOption(decision, option))) return "Tap the highlighted board target. Hold any object briefly to read its rules.";
  return "Choose an option.";
}

function decisionBriefTitle(session: EngineSession, decision: PendingDecision, action: ActionDefinition | null | undefined): string {
  if (decision.type === "GENESTEALER_ATTACK_ACK") {
    const marineId = decision.legalOptions[0]?.payload.marineId;
    return `Swarm attacking ${marineDisplayName(session, typeof marineId === "string" ? marineId : undefined)}`;
  }
  if (decision.type === "EVENT_MOVEMENT_ACK") {
    const count = Number(decision.legalOptions[0]?.payload.count ?? 0);
    return `${count} swarm${count === 1 ? "" : "s"} ready to move`;
  }
  if (decision.type === "TRAVEL_ANIMATION_ACK") return "Ready to travel";
  if (decision.type === "LOCATION_ARRIVAL_ACK") return "New location ready";
  if (action) return `${action.name} — ${actionCardSummary(action.type)}`;
  return sourceInspection(session, decision.sourceId)?.title ?? formatPhase(decision.type);
}

function conciseDecisionButtonLabel(decision: PendingDecision, option: DecisionOption): string {
  if (decision.type === "GENESTEALER_ATTACK_ACK") return "Proceed to attack";
  if (decision.type === "EVENT_MOVEMENT_ACK") return "Begin movement";
  if (decision.type === "EVENT_REVEAL_ACK") return "Resolve event";
  if (decision.type === "TRAVEL_ANIMATION_ACK") return "Travel";
  return presentedDecisionOption(decision, option).label;
}

function resolutionNoticesFrom(session: EngineSession, startingAt: number, throughTransitionSeq?: number): ResolutionNotice[] {
  const transitions = session.transitions.slice(startingAt).filter((transition) => throughTransitionSeq === undefined || transition.seq <= throughTransitionSeq);
  const eventDraw = transitions.find((transition) => transition.type === "CARD_DRAWN" && transition.sourceId === "event.deck");
  const eventId = eventDraw?.randomInputs.find((input) => input.kind === "DRAW")?.cardId;
  const resolvingEvent = eventId ? findEvent(eventId) : null;
  const spawned = transitions.flatMap((transition) => transition.randomInputs).filter((input) => input.kind === "DRAW" && (input.sourceId === "blip.left" || input.sourceId === "blip.right")).length;
  const moved = transitions.filter((transition) => transition.type === "SWARM_MOVED" || transition.type === "SWARM_FLANKED").length;
  let spawnNoticeAdded = false;
  let movementNoticeAdded = false;
  const notices: ResolutionNotice[] = [];
  for (const transition of transitions) {
    const id = `transition.${transition.seq}`;
    if (transition.type === "PHASE_ENDED" && transition.sourceId === "RESOLVE_ACTIONS") notices.push({ id, eyebrow: "Phase transition", title: "Genestealer attacks", body: "The selected squad actions are complete. Resolve each engaged Genestealer swarm in order." });
    else if (transition.type === "PHASE_ENDED" && transition.sourceId === "GENESTEALER_ATTACK") notices.push({ id, eyebrow: "Phase transition", title: "Event phase", body: "Genestealer attacks are complete. Draw and resolve the next Event card." });
    else if (transition.type === "ACTION_STARTED" && transition.sourceId) {
      const action = sourceInspection(session, transition.sourceId);
      const actionDefinition = data.definitions.actions.find((item) => item.id === componentDefinitionId(session, transition.sourceId!));
      if (action) notices.push({ id, eyebrow: action.eyebrow, title: action.title, body: action.body, meta: action.meta, team: actionDefinition?.team });
    }
    else if (transition.type === "ATTACK_SEQUENCE_FINISHED" && transition.sourceId) {
      const action = data.definitions.actions.find((item) => item.id === componentDefinitionId(session, transition.sourceId!));
      const actionStartSeq = [...session.transitions].reverse().find((candidate) => candidate.sourceId === transition.sourceId && candidate.type === "ACTION_STARTED")?.seq ?? 0;
      const hasAttacker = session.transitions.some((candidate) => candidate.sourceId === transition.sourceId && candidate.seq > actionStartSeq && candidate.type === "ATTACKER_SELECTED");
      if (action?.type === "ATTACK" && !hasAttacker) notices.push({ id, eyebrow: `${action.team} squad · Attack`, title: action.name, body: "No eligible Genestealers are in range and facing for this squad. The attack action ends without a roll.", team: action.team });
    }
    else if (transition.type === "CARD_DRAWN" && transition.sourceId === "event.deck") {
      const eventId = transition.randomInputs.find((input) => input.kind === "DRAW")?.cardId;
      const event = eventId ? findEvent(eventId) : null;
      if (event) notices.push({ id, eyebrow: "Event reveal", title: event.name, body: event.sourceText, meta: `${event.activations.map((activation) => `${formatPhase(activation.severity)} ${formatPhase(activation.terrainColor)}`).join(" · ")} · ${event.movementIcon ? `${ICON_LABELS[event.movementIcon]} ${event.movement?.toLowerCase() ?? "movement"}` : "No movement"}` });
    }
    else if (!spawnNoticeAdded && transition.type === "CARD_DRAWN" && (transition.sourceId === "blip.left" || transition.sourceId === "blip.right") && spawned > 0) {
      spawnNoticeAdded = true;
      const terrainIds = transitions.filter((candidate) => candidate.type === "EVENT_TERRAIN_SPAWN_RESOLVED" && candidate.sourceId).map((candidate) => candidate.sourceId!);
      notices.push({ id, eyebrow: "Spawn activations", title: `${spawned} Genestealer${spawned === 1 ? "" : "s"} spawned`, body: "Both Event activations are shown on the brightly highlighted Terrain positions.", meta: resolvingEvent?.activations.map((activation) => `${formatPhase(activation.severity)} ${formatPhase(activation.terrainColor)}`).join(" · "), presentation: "board", terrainIds });
    } else if (!movementNoticeAdded && (transition.type === "SWARM_MOVED" || transition.type === "SWARM_FLANKED") && moved > 0) {
      movementNoticeAdded = true;
      notices.push({ id, eyebrow: "Genestealer movement", title: `${moved} swarm${moved === 1 ? "" : "s"} moving`, body: "The formation stays visible while every matching swarm advances or flanks.", presentation: "movement" });
    } else if (transition.type === "EVENT_MOVEMENT_RESOLVED" && moved === 0) notices.push({ id, eyebrow: "Genestealer movement", title: "No swarms move", body: "No Genestealer swarm matches this Event card's movement icon." });
    else if (transition.type === "TRAVEL_STARTED") notices.push({ id, eyebrow: "Travel", title: "Travel begins", body: "Resolve Door effects and any required travel choices before revealing the next Location." });
    else if (transition.type === "CARD_DRAWN" && transition.sourceId === "location.deck") {
      const locationId = transition.randomInputs.find((input) => input.kind === "DRAW")?.cardId;
      const location = locationId ? sourceInspection(session, locationId) : null;
      if (location) notices.push({ id, eyebrow: "New location", title: location.title, body: location.body, meta: location.meta });
    } else if (transition.type === "ROUND_ENDED") notices.push({ id, eyebrow: "", title: `Round ${session.state.round}`, body: "Choose a new action card for each active squad." });
  }
  return notices;
}

function eventMovementAnimationFrom(session: EngineSession, resolved: EngineSession, startingAt: number): BoardAnimation | null {
  const transitions = resolved.transitions.slice(startingAt);
  const movementTransitions = transitions.filter((transition) => transition.type === "SWARM_MOVED" || transition.type === "SWARM_FLANKED");
  if (!movementTransitions.length) return null;
  const eventDraw = transitions.find((transition) => transition.type === "CARD_DRAWN" && transition.sourceId === "event.deck");
  const eventId = eventDraw?.randomInputs.find((input) => input.kind === "DRAW")?.cardId ?? session.state.eventRuntime?.eventCardId;
  const event = eventId ? findEvent(componentDefinitionId(session, eventId)) : null;
  if (!event?.movementIcon) return null;
  const movingSwarmCells: Record<string, "up" | "down" | "flank"> = {};
  for (const swarm of Object.values(session.state.swarms)) {
    const hasMatchingIcon = swarm.cardIds.some((cardId) => session.state.genestealers[cardId]?.icon === event.movementIcon);
    if (!hasMatchingIcon) continue;
    movingSwarmCells[cellKey(swarm.positionIndex, swarm.side)] = event.movement === "FLANK" ? "flank" : swarm.side === "LEFT" ? "down" : "up";
  }
  return Object.keys(movingSwarmCells).length ? { movingSwarmCells } : null;
}

function eventMovementPresentationFrom(session: EngineSession, resolved: EngineSession, startingAt: number): MovementPresentation | null {
  const movementTransition = resolved.transitions.slice(startingAt).find((transition) => transition.type === "SWARM_MOVED" || transition.type === "SWARM_FLANKED");
  const animation = eventMovementAnimationFrom(session, resolved, startingAt);
  return movementTransition && animation ? { id: `transition.${movementTransition.seq}`, sourceSession: session, resolvedSession: resolved, animation } : null;
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
        // `session` may already be waiting on the next queued Genestealer
        // attack by the time this die is presented. Anchor the animation to
        // the runtime that existed when this die was actually rolled.
        ? priorState.genestealerAttackRuntime?.defenderMarineId
          ?? session.state.genestealerAttackRuntime?.defenderMarineId
          ?? priorState.formation[priorState.swarms[input.sourceId]?.positionIndex ?? -1]?.marineInstanceId
        : undefined;
      const hit = Boolean(input.dieSkull);
      const laterTransitions = newTransitions.filter((candidate) => candidate.seq > transition.seq);
      const defenseOutcome = laterTransitions.some((candidate) => candidate.type === "MARINE_SLAIN")
        ? "death"
        : laterTransitions.some((candidate) => candidate.type === "GENESTEALER_ATTACK_MISSED")
          ? "dodge"
          : null;
      const defenseSwarm = defense ? priorState.swarms[input.sourceId] : undefined;
      const defenseStrength = defenseSwarm ? defenseSwarm.cardIds.length + defenseSwarm.broodLordIds.length : 0;
      const deadAimSpecial = input.sourceId === "action.green.dead-aim" && input.dieValue === 4;
      const outcome = marineAttack
        ? deadAimSpecial ? "Special hit · Dead Aim: slay up to 3 Genestealers."
          : hit ? "Hit" : "Miss"
        : defense
          ? defenseOutcome === "death" ? "Marine slain" : defenseOutcome === "dodge" ? "Dodged" : input.dieValue! > defenseStrength ? "Dodged" : "Marine slain"
          : `Result ${input.dieValue}`;
      const relevantSwarmId = marineAttack ? targetSwarmId : defense ? input.sourceId : undefined;
      const relevantPosition = typeof relevantSwarmId === "string" ? priorState.swarms[relevantSwarmId]?.positionIndex : undefined;
      const slayChoicePending = session.state.pendingDecision?.type === "ATTACK_SLAY";
      const postRollAnimation: BoardAnimation | null = marineAttack && marineId && !slayChoicePending
        ? { marineId, swarmId: targetSwarmId, marineAnimation: `${hit ? "fire" : "gunJam"}-${attackTrajectory(priorState, marineId, targetSwarmId)}` as BoardAnimation["marineAnimation"], ...(hit ? { swarmAnimation: "death" as const } : {}) }
        : defense && marineId && defenseOutcome
          ? { marineId, marineAnimation: defenseOutcome, swarmId: input.sourceId, swarmAnimation: "attack" }
          : null;
      return {
        postRollAnimation,
        outcome,
        placement: relevantPosition !== undefined && relevantPosition >= priorState.formation.length / 2 ? "top" : "bottom",
        id: `${transition.seq}.${index}`,
        value: input.dieValue!,
        skull: Boolean(input.dieSkull),
        title: inspection?.title ?? (input.sourceId.startsWith("swarm.") ? "Genestealer attack" : "Combat die"),
        reroll: transition.type === "DIE_REROLLED",
        transitionSeq: transition.seq,
      };
    }));
}

type TacticalButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  onTap?: () => void;
  onHold?: () => void;
  onHover?: (anchor: DOMRect) => void;
  onHoverEnd?: () => void;
  stopPropagation?: boolean;
};

function TacticalButton({ onTap, onHold, stopPropagation, onPointerDown, onPointerUp, onPointerCancel, onPointerEnter, onPointerLeave, onContextMenu, ...props }: TacticalButtonProps) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const cancelTimer = () => {
    if (timer.current !== null) globalThis.clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <button
      {...props}
      onPointerEnter={(event) => {
        // Preserve the established desktop path: hover uses the same detail
        // trigger as a touch hold. Presentation can evolve independently.
        if (event.pointerType === "mouse" && onHold) timer.current = globalThis.setTimeout(() => { timer.current = null; onHold(); }, 700);
        onPointerEnter?.(event);
      }}
      onPointerDown={(event) => {
        cancelTimer();
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

function LiveActionSelection({ compact = false, session, onChooseOption, tutorialGuide }: { compact?: boolean; session: EngineSession; onChooseOption: (optionId: string) => void; tutorialGuide?: TutorialActionGuide | null }) {
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
    if (tutorialGuide && !(cardsByTeam[team] ?? []).some((card) => tutorialGuide.allowedActionIds.has(card.instanceId))) return;
    setExpandedTeam((current) => current === team ? null : team);
    setPendingActionId(null);
  };
  const pendingOption = pendingActionId ? uniquePayloadOption(decision, "actionId", pendingActionId) : null;
  const expandedCards = expandedTeam ? cardsByTeam[expandedTeam] ?? [] : [];

  return (
    <section className={`live-action-dock ${choosingActions ? "is-choosing" : ""} ${compact ? "is-compact" : ""} ${expandedTeam ? "is-expanded" : ""}`} aria-label="Combat team action cards">
      {expandedTeam && choosingActions && (
        <><button type="button" className="live-hand-dismiss" aria-label="Close action hand" onClick={() => setExpandedTeam(null)} /><div className={`live-expanded-hand lab-team-${expandedTeam.toLowerCase()}`}>
          <header><span>{expandedTeam} squad</span><strong>Choose an action</strong><button type="button" onClick={() => setExpandedTeam(null)} aria-label="Close action hand">×</button></header>
          <div className="live-full-action-grid">
            {expandedCards.map((card) => {
              const option = uniquePayloadOption(decision, "actionId", card.instanceId);
              const unavailable = !option || Boolean(tutorialGuide && !tutorialGuide.allowedActionIds.has(card.instanceId));
              const recommended = Boolean(option && tutorialGuide?.allowedActionIds.has(card.instanceId));
              return <button type="button" key={card.instanceId} className={`live-full-action-card lab-team-${card.team.toLowerCase()} ${pendingActionId === card.instanceId ? "is-pending" : ""} ${recommended ? "is-tutorial-recommended" : ""} ${unavailable ? "is-unavailable" : ""}`} disabled={unavailable} onClick={() => setPendingActionId(card.instanceId)}>
                <small>{formatActionType(card.type)}</small><em className="action-initiative" aria-label={`Initiative ${card.initiative}`}>{card.initiative}</em><strong>{card.name}</strong><p>{card.sourceText}</p>{unavailable && <i aria-hidden="true">×</i>}
              </button>;
            })}
          </div>
          <button type="button" className="live-confirm-action" disabled={!pendingOption} onClick={() => { if (pendingOption) { setExpandedTeam(null); setPendingActionId(null); onChooseOption(pendingOption.id); } }}>Select action</button>
        </div></>
      )}
      <div className={`live-action-hands ${selectionComplete && !choosingActions ? "is-initiative-order" : ""}`}>
        {displayTeams.map((team, orderIndex) => {
          const cards = cardsByTeam[team] ?? [];
          const chosenId = state.teams[team].chosenActionInstanceId;
          const selected = cards.find((card) => card.instanceId === chosenId) ?? orderedCards.find((card) => card.team === team) ?? null;
          const resolutionState = !choosingActions && activeIndex >= 0 ? orderIndex < activeIndex ? "is-completed" : orderIndex === activeIndex ? "is-active" : "is-upcoming" : "";
          const conciseSelectedCard = compact || choosingActions;
          const teamHasGuidedChoice = cards.some((card) => tutorialGuide?.allowedActionIds.has(card.instanceId));
          return <button key={team} type="button" className={`live-action-team-slot lab-team-${team.toLowerCase()} ${selected ? "has-selection" : ""} ${tutorialGuide && teamHasGuidedChoice ? "is-tutorial-recommended" : ""} ${resolutionState}`} onClick={() => openTeam(team)} disabled={!choosingActions || Boolean(selected) || Boolean(tutorialGuide && !teamHasGuidedChoice)}>
            {!selected && <span className="live-action-team-name">{team}</span>}
            {selected ? <span className={`live-chosen-action ${conciseSelectedCard ? "is-compact-card" : ""}`}>{conciseSelectedCard ? <><span className="compact-card-type"><small>{selected.type === "MOVE_ACTIVATE" ? "Move" : formatActionType(selected.type)}</small><em className="action-initiative" aria-label={`Initiative ${selected.initiative}`}>{selected.initiative}</em></span><strong>{selected.name}</strong></> : <><em className="action-initiative" aria-label={`Initiative ${selected.initiative}`}>{selected.initiative}</em><strong>{selected.name}</strong><small>— {actionCardSummary(selected.type)}</small></>}</span> : <span className="live-mini-hand">{cards.map((card, index) => {
              const unavailable = !uniquePayloadOption(decision, "actionId", card.instanceId) || Boolean(tutorialGuide && !tutorialGuide.allowedActionIds.has(card.instanceId));
              return <span key={card.instanceId} className={`live-mini-action-card ${unavailable ? "is-unavailable" : ""}`} style={{ "--card-index": index } as CSSProperties}><b>{card.type === "MOVE_ACTIVATE" ? "Move" : formatActionType(card.type)}</b></span>;
            })}</span>}
          </button>;
        })}
      </div>
    </section>
  );
}

function TeamActionPreview({ team, onClose }: { team: TeamColor; onClose: () => void }) {
  const cards = data.definitions.actions.filter((action) => action.team === team).sort((left, right) => left.initiative - right.initiative);
  const marines = data.definitions.marines.filter((marine) => marine.team === team);
  return <div className="team-preview-backdrop" role="presentation"><button type="button" className="team-preview-dismiss" aria-label="Close squad action-card review" onClick={onClose} /><section className={`team-preview team-${team.toLowerCase()}`} role="dialog" aria-modal="true" aria-label={`${team} squad action cards`}>
    <header><span>{team} squad</span><h2>Action cards</h2><button type="button" onClick={onClose} aria-label="Close squad action-card review">×</button></header>
    <ul className="team-preview-marines">{marines.map((marine) => <li key={marine.id}><strong>{marine.name}</strong><span>Range {marine.attackRange}</span></li>)}</ul>
    <div>{cards.map((card) => <article key={card.id}><small>{formatActionType(card.type)}</small><em className="action-initiative" aria-label={`Initiative ${card.initiative}`}>{card.initiative}</em><strong>{card.name}</strong><p>{card.sourceText}</p></article>)}</div>
  </section></div>;
}

export default function GameClient() {
  const [selectedTeams, setSelectedTeams] = useState<TeamColor[]>([]);
  const [playMode, setPlayMode] = useState<PlayMode>("STANDARD");
  const [teamPreview, setTeamPreview] = useState<TeamColor | null>(null);
  const [session, setSession] = useState<EngineSession | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [hoverInspection, setHoverInspection] = useState<HoverInspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rollNotices, setRollNotices] = useState<RollNotice[]>([]);
  const [resolutionNotices, setResolutionNotices] = useState<ResolutionNotice[]>([]);
  const [pendingRollResolution, setPendingRollResolution] = useState<PendingRollResolution | null>(null);
  const [boardAnimation, setBoardAnimation] = useState<BoardAnimation | null>(null);
  const [slayChoiceAnimating, setSlayChoiceAnimating] = useState(false);
  const [travelStage, setTravelStage] = useState<TravelStage | null>(null);
  const [restoreComplete, setRestoreComplete] = useState(false);
  const animationTimer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const travelTimers = useRef<Array<ReturnType<typeof globalThis.setTimeout>>>([]);
  const movementPresentations = useRef(new Map<string, MovementPresentation>());
  const activeMovementPresentation = useRef<string | null>(null);

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
  const clearTravelTimers = () => { travelTimers.current.forEach(globalThis.clearTimeout); travelTimers.current = []; setTravelStage(null); };

  useEffect(() => {
    const notice = resolutionNotices[0];
    if (!notice || notice.presentation !== "movement" || activeMovementPresentation.current) return;
    const presentation = movementPresentations.current.get(notice.id);
    if (!presentation) {
      setResolutionNotices((current) => current.slice(1));
      return;
    }
    activeMovementPresentation.current = notice.id;
    setSession(presentation.sourceSession);
    if (animationTimer.current !== null) globalThis.clearTimeout(animationTimer.current);
    setBoardAnimation(presentation.animation);
    animationTimer.current = globalThis.setTimeout(() => {
      animationTimer.current = null;
      setBoardAnimation(null);
      setSession(presentation.resolvedSession);
      movementPresentations.current.delete(notice.id);
      activeMovementPresentation.current = null;
      setResolutionNotices((current) => current[0]?.id === notice.id ? current.slice(1) : current);
    }, 1150);
  }, [resolutionNotices]);

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

  const startGame = (teams = selectedTeams) => {
    if (teams.length !== 3) return;
    try {
      const gameId = globalThis.crypto?.randomUUID?.() ?? `game-${Date.now()}`;
      const seed = `${gameId}:${teams.join("-")}`;
      const prepared = prepareUiSession(newEngineSession({ gameId, seed, teamColors: teams as [TeamColor, TeamColor, TeamColor] }, "PLAYER"));
      setSession(prepared.session);
      setPlayMode("STANDARD");
      setSelectedTeams(teams);
      setTeamPreview(null);
      setResolutionNotices([]);
      setInspection(null);
      setError(prepared.error);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The mission could not be started.");
    }
  };

  const startRandomGame = () => {
    const available = [...TEAM_COLORS];
    for (let index = available.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [available[index], available[swapIndex]] = [available[swapIndex], available[index]];
    }
    startGame(available.slice(0, 3));
  };

  const startTutorial = () => {
    try {
      const prepared = prepareUiSession(newEngineSession({ gameId: "tutorial-v1", seed: "tutorial-v1.green-blue-red", teamColors: ["GREEN", "BLUE", "RED"] }, "PLAYER"));
      setSession(prepared.session);
      setPlayMode("TUTORIAL");
      setTeamPreview(null);
      setResolutionNotices([]);
      setInspection(null);
      setError(prepared.error);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The tutorial could not be started.");
    }
  };

  const resolveDecision = (optionId: string) => {
    const decision = session?.state.pendingDecision;
    if (!session || !decision) return;
    try {
      const prepared = prepareUiSession(submitSessionDecision(session, decision.id, optionId));
      if (decision.type === "TRAVEL_ANIMATION_ACK") {
        clearTravelTimers();
        setSession(session);
        setTravelStage("retreat");
        travelTimers.current.push(globalThis.setTimeout(() => setTravelStage("crossfade"), 2550));
        travelTimers.current.push(globalThis.setTimeout(() => { setSession(prepared.session); setTravelStage("arrive"); }, 3000));
        travelTimers.current.push(globalThis.setTimeout(() => { setTravelStage(null); travelTimers.current = []; }, 4450));
        setInspection(null);
        setError(prepared.error);
        return;
      }
      const selectedOption = decision.legalOptions.find((option) => option.id === optionId);
      const notices = rollNoticesFrom(prepared.session, session.transitions.length, session.state, selectedOption);
      const movementPresentation = decision.type === "EVENT_MOVEMENT_ACK" ? eventMovementPresentationFrom(session, prepared.session, session.transitions.length) : null;
      if (movementPresentation) movementPresentations.current.set(movementPresentation.id, movementPresentation);
      const resolutionNotices = resolutionNoticesFrom(prepared.session, session.transitions.length, notices[0]?.transitionSeq)
        .filter((notice) => prepared.session.state.pendingDecision?.type !== "FORWARD_SCOUTING_ORDER" || notice.eyebrow !== "Event reveal");
      if (decision.type === "ATTACK_SLAY") {
        const marineId = session.state.actionRuntime?.data.attackerId;
        const swarmId = selectedOption?.payload.swarmId;
        const animation = typeof marineId === "string" && typeof swarmId === "string"
          ? { marineId, swarmId, marineAnimation: `fire-${attackTrajectory(session.state, marineId, swarmId)}` as BoardAnimation["marineAnimation"], swarmAnimation: "death" as const }
          : null;
        if (animation) {
          setSlayChoiceAnimating(true);
          playBoardAnimation(animation, 1400, () => {
            setSession(prepared.session);
            setSlayChoiceAnimating(false);
            setResolutionNotices(resolutionNotices);
            if (notices.length) {
              setPendingRollResolution({ session: prepared.session });
              setRollNotices(notices);
            }
          });
        } else {
          setSession(prepared.session);
          setResolutionNotices(resolutionNotices);
          if (notices.length) {
            setPendingRollResolution({ session: prepared.session });
            setRollNotices(notices);
          }
        }
        setInspection(null);
        setError(prepared.error);
        return;
      }
      setResolutionNotices(resolutionNotices);
      if (notices.length) {
        setPendingRollResolution({ session: prepared.session });
        setRollNotices(notices);
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
    setResolutionNotices([]);
    setPendingRollResolution(null);
    setSlayChoiceAnimating(false);
    clearBoardAnimationTimer();
    setBoardAnimation(null);
    movementPresentations.current.clear();
    activeMovementPresentation.current = null;
    clearTravelTimers();
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
    setPlayMode("STANDARD");
    setTeamPreview(null);
    setInspection(null);
    setSelectedTeams([]);
    setError(null);
    setRollNotices([]);
    setResolutionNotices([]);
    setPendingRollResolution(null);
    setSlayChoiceAnimating(false);
    clearBoardAnimationTimer();
    setBoardAnimation(null);
    movementPresentations.current.clear();
    activeMovementPresentation.current = null;
    clearTravelTimers();
  };

  if (!restoreComplete) return <main className="restore-shell"><span>Restoring mission state…</span></main>;

  if (!session) {
    return (
      <main className="setup-shell">
        <section className="setup-panel" aria-labelledby="setup-title">
          <div className="brand-lockup"><span className="brand-kicker">Space Hulk</span><h1 id="setup-title">Death Angel</h1><p>Solo mission command</p></div>
          <div className="setup-copy"><span className="section-number">01</span><div><h2>Select three combat teams</h2><p>Choose any three squads to form your boarding party.</p></div></div>
          <div className="team-grid">
            {TEAM_COLORS.map((team) => {
              const selected = selectedTeams.includes(team);
              return (
                <TacticalButton key={team} type="button" className={`team-choice team-${team.toLowerCase()}`} aria-pressed={selected} onTap={() => toggleTeam(team)} onHold={() => setTeamPreview(team)}>
                  <span className="team-sigil" aria-hidden="true">{selected ? "✓" : "+"}</span>
                  <span><strong>{team}</strong><small>{teamMarineNames(team)}</small></span>
                </TacticalButton>
              );
            })}
          </div>
          <div className="setup-footer"><span>{selectedTeams.length} / 3 selected</span><button type="button" className="random-mission-command" onClick={startRandomGame}>Random squads</button><button type="button" className="primary-command" disabled={selectedTeams.length !== 3} onClick={() => startGame()}>Begin mission</button></div>
          <button type="button" className="tutorial-command" onClick={startTutorial}><strong>Guided tutorial</strong><small>Learn the HUD and play through a fixed beginner mission.</small></button>
          {error && <p className="error-message" role="alert">{error}</p>}
        </section>
        {teamPreview && <TeamActionPreview team={teamPreview} onClose={() => setTeamPreview(null)} />}
      </main>
    );
  }

  const proceedRoll = (optionId?: string) => {
    const notice = rollNotices[0];
    const resolve = pendingRollResolution;
    if (!notice || !resolve) { setRollNotices((current) => current.slice(1)); return; }
    const rollDecision = resolve.session.state.pendingDecision;
    let finalSession = resolve.session;
    let animation = notice.postRollAnimation;
    try {
      if (optionId && isRollFollowUp(rollDecision)) {
        const prepared = prepareUiSession(submitSessionDecision(resolve.session, rollDecision.id, optionId));
        const selectedOption = rollDecision.legalOptions.find((option) => option.id === optionId);
        const rerollNotices = rollNoticesFrom(prepared.session, resolve.session.transitions.length, resolve.session.state, selectedOption);
        if (rerollNotices.length) {
          setPendingRollResolution({ session: prepared.session });
          setRollNotices(rerollNotices);
          setError(prepared.error);
          return;
        }
        finalSession = prepared.session;
        const movementPresentation = rollDecision?.type === "EVENT_MOVEMENT_ACK" ? eventMovementPresentationFrom(resolve.session, prepared.session, resolve.session.transitions.length) : null;
        if (movementPresentation) movementPresentations.current.set(movementPresentation.id, movementPresentation);
        if (!animation && resolve.session.state.genestealerAttackRuntime) {
          const runtime = resolve.session.state.genestealerAttackRuntime;
          const transitions = prepared.session.transitions.slice(resolve.session.transitions.length);
          const outcome = transitions.some((transition) => transition.type === "MARINE_SLAIN") ? "death"
            : transitions.some((transition) => transition.type === "GENESTEALER_ATTACK_MISSED") ? "dodge" : null;
          if (outcome) animation = { marineId: runtime.defenderMarineId, marineAnimation: outcome };
        }
        setError(prepared.error);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That die choice could not be resolved.");
      return;
    }
    const duration = animation?.marineAnimation?.startsWith("gunJam") ? 1800 : 1400;
    const deferredNotices = resolutionNoticesFrom(finalSession, notice.transitionSeq);
    if (animation) {
      // The die result has been acknowledged. Remove its modal before the
      // consequence plays so the animation is the only thing in focus.
      setRollNotices([]);
      playBoardAnimation(animation, duration, () => {
        setSession(finalSession);
        setPendingRollResolution(null);
        setResolutionNotices((current) => [...current, ...deferredNotices]);
      });
    } else {
      setSession(finalSession);
      setPendingRollResolution(null);
      setRollNotices([]);
      setResolutionNotices((current) => [...current, ...deferredNotices]);
    }
  };

  const rollDecision = isRollFollowUp(pendingRollResolution?.session.state.pendingDecision ?? null) ? pendingRollResolution?.session.state.pendingDecision ?? null : null;
  return <MissionBoard tutorial={playMode === "TUTORIAL"} session={session} travelStage={travelStage} boardAnimation={boardAnimation} inspection={inspection} hoverInspection={hoverInspection} error={error} resolutionNotice={resolutionNotices[0] ?? null} rollNotice={resolutionNotices.length ? null : rollNotices[0] ?? null} rollDecision={rollDecision} slayChoiceAnimating={slayChoiceAnimating} onDismissResolutionNotice={() => {
    const notice = resolutionNotices[0];
    if (notice?.eyebrow === "Event reveal" && session?.state.pendingDecision?.type === "EVENT_REVEAL_ACK") {
      setResolutionNotices((current) => current.slice(1));
      resolveDecision("begin");
      return;
    }
    setResolutionNotices((current) => current.slice(1));
  }} onDismissRoll={proceedRoll} onInspect={setInspection} onHoverInspect={(details, anchor) => setHoverInspection({ ...details, anchor: { top: anchor.top, bottom: anchor.bottom, left: anchor.left, right: anchor.right } })} onDismissHoverInspection={() => setHoverInspection(null)} onChooseOption={resolveDecision} onUndo={undoOne} onDownloadSave={downloadSave} onDismissInspection={() => setInspection(null)} onNewMission={startNewMission} />;
}

type MissionBoardProps = {
  session: EngineSession;
  travelStage: TravelStage | null;
  tutorial: boolean;
  boardAnimation: BoardAnimation | null;
  inspection: Inspection | null;
  hoverInspection: HoverInspection | null;
  error: string | null;
  resolutionNotice: ResolutionNotice | null;
  rollNotice: RollNotice | null;
  rollDecision: PendingDecision | null;
  slayChoiceAnimating: boolean;
  onInspect: (inspection: Inspection) => void;
  onHoverInspect: (inspection: Inspection, anchor: DOMRect) => void;
  onDismissHoverInspection: () => void;
  onDismissResolutionNotice: () => void;
  onChooseOption: (optionId: string) => void;
  onUndo: () => void;
  onDownloadSave: () => void;
  onDismissInspection: () => void;
  onDismissRoll: (optionId?: string) => void;
  onNewMission: () => void;
};

function MissionBoard({ session, travelStage, tutorial, boardAnimation, inspection, hoverInspection, error, resolutionNotice, rollNotice, rollDecision, slayChoiceAnimating, onInspect, onHoverInspect, onDismissHoverInspection, onChooseOption, onUndo, onDownloadSave, onDismissInspection, onDismissResolutionNotice, onDismissRoll, onNewMission }: MissionBoardProps) {
  const [moveSelection, setMoveSelection] = useState<{ decisionId: string; marineId: string } | null>(null);
  const [strategizeSelection, setStrategizeSelection] = useState<{ decisionId: string; swarmId: string } | null>(null);
  const [doorSwarmSelection, setDoorSwarmSelection] = useState<{ decisionId: string; swarmId: string } | null>(null);
  const [heroicChargeSwarmSelection, setHeroicChargeSwarmSelection] = useState<{ decisionId: string; swarmId: string } | null>(null);
  const [eventSlaySwarmSelection, setEventSlaySwarmSelection] = useState<{ decisionId: string; swarmId: string } | null>(null);
  const [scoutingPreviewVisible, setScoutingPreviewVisible] = useState(true);
  const [missionInfoCollapsed, setMissionInfoCollapsed] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuScreen, setMenuScreen] = useState<"ROOT" | "SETTINGS" | "HELP">("ROOT");
  const [bottomView, setBottomView] = useState<"cards" | "status">("cards");
  const [seenStatusKey, setSeenStatusKey] = useState<string | null>(null);
  const [tutorialIntroStep, setTutorialIntroStep] = useState(tutorial ? 0 : -1);
  const [desktopBoardScale, setDesktopBoardScale] = useState<DesktopBoardScale>(() => {
    const saved = globalThis.localStorage?.getItem(DESKTOP_BOARD_SCALE_KEY);
    return saved === "AUTO" || saved === "COMPACT" || saved === "STANDARD" || saved === "LARGE" ? saved : "AUTO";
  });
  const traySwipeStart = useRef<{ x: number; y: number } | null>(null);
  const desktopUiScale = useBoardScale(desktopBoardScale);
  const { state } = session;
  const decision = state.pendingDecision;
  const choosingActions = decision?.type === "CHOOSE_ACTION";
  const selectedMoveMarineId = moveSelection && moveSelection.decisionId === decision?.id ? moveSelection.marineId : null;
  const strategizeSwarms = useMemo(() => strategizeSwarmIds(decision), [decision]);
  const strategizeSwarmSet = useMemo(() => new Set(strategizeSwarms), [strategizeSwarms]);
  const selectedStrategizeSwarmId = strategizeSelection && strategizeSelection.decisionId === decision?.id && strategizeSwarmSet.has(strategizeSelection.swarmId) ? strategizeSelection.swarmId : null;
  const selectedDoorSwarmId = doorSwarmSelection && doorSwarmSelection.decisionId === decision?.id && decision?.type === "DOOR_TRAVEL_SLAY" ? doorSwarmSelection.swarmId : null;
  const heroicChargeSlay = decision?.type === "ATTACK_SLAY" && state.actionStep === "HEROIC_CHARGE_SLAY";
  const selectedHeroicChargeSwarmId = heroicChargeSwarmSelection && heroicChargeSwarmSelection.decisionId === decision?.id && heroicChargeSlay ? heroicChargeSwarmSelection.swarmId : null;
  const selectedEventSlaySwarmId = eventSlaySwarmSelection && eventSlaySwarmSelection.decisionId === decision?.id && (decision?.type === "EVENT_SLAY" || decision?.type === "INTIMIDATION_PICK") ? eventSlaySwarmSelection.swarmId : null;
  const targetIds = useMemo(() => {
    const ids = decision?.type === "STRATEGIZE" ? new Set<string>() : pendingTargetIds(decision);
    if (decision?.type === "INTIMIDATION_PICK") for (const swarm of Object.values(state.swarms)) if (swarm.cardIds.some((cardId) => decision.legalOptions.some((option) => option.payload.cardId === cardId))) ids.add(swarm.id);
    return ids;
  }, [decision, state.swarms]);
  const currentLocation = data.definitions.locations.find((item) => item.id === componentDefinitionId(session, state.currentLocationInstanceId));
  const locationInspection = sourceInspection(session, state.currentLocationInstanceId) ?? { eyebrow: "Setup location", title: setupLocationName(componentDefinitionId(session, state.currentLocationInstanceId)), body: "Starting location for the solo mission.", meta: "Void Lock" };
  const leftBlips = state.orderedSources["blip.left"]?.length ?? 0;
  const rightBlips = state.orderedSources["blip.right"]?.length ?? 0;
  const livingMarines = state.formation.length;
  const undoStatus = getUndoStatus(session);
  const lastEventId = state.eventRuntime?.eventCardId ?? state.orderedSources["event.discard"]?.at(-1) ?? null;
  const lastEvent = lastEventId ? findEvent(lastEventId) : null;
  const formationMarineIds = new Set(state.formation.map((slot) => slot.marineInstanceId));
  const dockOptions = decision?.legalOptions.filter((option) => decision.type === "STRATEGIZE"
    ? option.payload.skip === true
    : decision.type === "GENESTEALER_ATTACK_ACK"
      ? true
    : decision.type === "DOOR_TRAVEL_SLAY" || heroicChargeSlay || decision.type === "EVENT_SLAY" || decision.type === "INTIMIDATION_PICK"
      ? option.payload.stop === true
      : isOffBoardMarineOption(option, formationMarineIds) || !isDirectInputOption(decision, option)) ?? [];
  const orderedDockOptions = decision?.type === "STEALTH_FIRST"
    ? [...dockOptions].sort((left, right) => {
      const rank = (option: DecisionOption) => option.payload.skip ? 2 : option.payload.side === "LEFT" ? 0 : 1;
      return rank(left) - rank(right);
    })
    : dockOptions;
  const decisionAction = decision ? data.definitions.actions.find((item) => item.id === componentDefinitionId(session, decision.sourceId)) : null;
  const decisionRules = decision?.type === "PLACE_ARTEFACT"
    ? data.definitions.terrain.find((item) => item.id === "terrain.artefact")?.sourceText ?? null
    : null;
  const decisionBrief = decision ? decisionBriefTitle(session, decision, decisionAction) : null;
  const decisionText = decision ? decisionInstruction(session, decision, selectedMoveMarineId, selectedStrategizeSwarmId, scoutingPreviewVisible) : null;
  const statusKey = !choosingActions ? decision?.id ?? (resolutionNotice?.presentation === "board" ? resolutionNotice.id : null) : null;
  const displayedBottomView = choosingActions ? "cards" : statusKey && seenStatusKey !== statusKey ? "status" : bottomView;
  const tutorialTarget = tutorialIntroStep >= 0 ? TUTORIAL_HUD_TOUR[tutorialIntroStep]?.target ?? null : null;
  const activeTutorialGuide = tutorial && tutorialIntroStep < 0 ? tutorialActionGuide(session) : null;
  const chooseDesktopBoardScale = (preference: DesktopBoardScale) => {
    setDesktopBoardScale(preference);
    globalThis.localStorage?.setItem(DESKTOP_BOARD_SCALE_KEY, preference);
  };
  const closeMenu = () => { setMenuOpen(false); setMenuScreen("ROOT"); };
  const composeEmail = (subject: string, body?: string) => {
    const query = [`subject=${encodeURIComponent(subject)}`, ...(body ? [`body=${encodeURIComponent(body)}`] : [])].join("&");
    globalThis.location.href = `mailto:shepps36@gmail.com?${query}`;
  };
  const setTrayView = (view: "cards" | "status") => { setSeenStatusKey(statusKey); setBottomView(view); };
  const startTraySwipe = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".round-rail-tab, .dock-options button, a")) return;
    traySwipeStart.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const finishTraySwipe = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = traySwipeStart.current;
    traySwipeStart.current = null;
    if (!start) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 42 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.35) return;
    if (deltaX < 0 && displayedBottomView === "cards") setTrayView("status");
    if (deltaX > 0 && displayedBottomView === "status") setTrayView("cards");
  };

  return (
    <main className={`mission-shell ${choosingActions ? "is-choosing-actions" : ""}`} style={{ "--desktop-ui-scale": desktopUiScale.toFixed(3) } as CSSProperties}>
      <section className={`lab-hud ${missionInfoCollapsed ? "is-collapsed" : "is-expanded"}`} aria-label="Mission status">
        <div className="lab-hud-command">
          <div className={`live-hud-stats ${tutorialTarget === "stats" ? "is-tutorial-focus" : ""}`}><span>Marines <b>{livingMarines}/6</b></span><span>Support <b><i>●</i>{state.supportSupply}</b></span></div>
          <div className={`lab-hud-cycle ${tutorialTarget === "round" ? "is-tutorial-focus" : ""}`}><span>Round</span><strong>{String(state.round).padStart(2, "0")}</strong></div>
          <div className={`lab-hud-phase ${tutorialTarget === "phase" ? "is-tutorial-focus" : ""}`}><span>Current phase</span><strong>{formatPhase(state.phase)}</strong></div>
          <div className="live-hud-tools"><button type="button" className="live-hud-undo" aria-label="Undo last action" disabled={!undoStatus.allowed} onClick={onUndo}>↶</button><div className="live-hud-menu"><button type="button" aria-label="Open game menu" aria-expanded={menuOpen} onClick={() => { setMenuOpen((current) => !current); setMenuScreen("ROOT"); }}>☰</button>{menuOpen && <div className="live-hud-menu-panel">{menuScreen === "ROOT" ? <section className="live-menu-root"><header><strong>Command Menu</strong><button type="button" aria-label="Close menu" onClick={closeMenu}>×</button></header><div><button type="button" onClick={() => setMenuScreen("SETTINGS")}><strong>Settings</strong></button><button type="button" onClick={() => setMenuScreen("HELP")}><strong>Help</strong></button><button type="button" onClick={() => { if (globalThis.confirm("End this mission and return to team selection?")) { onNewMission(); closeMenu(); } }}><strong>New Mission</strong></button></div></section> : menuScreen === "SETTINGS" ? <section className="live-menu-subpanel is-settings"><header><button type="button" aria-label="Back to menu" onClick={() => setMenuScreen("ROOT")}>‹</button><strong>Settings</strong><button type="button" aria-label="Close menu" onClick={closeMenu}>×</button></header><div className="live-hud-menu-scale"><strong>Desktop scale</strong><div>{(["AUTO", "COMPACT", "STANDARD", "LARGE"] as DesktopBoardScale[]).map((preference) => <button key={preference} type="button" className={desktopBoardScale === preference ? "is-active" : ""} onClick={() => chooseDesktopBoardScale(preference)}>{preference[0] + preference.slice(1).toLowerCase()}</button>)}</div></div></section> : <section className="live-menu-subpanel is-help"><header><button type="button" aria-label="Back to menu" onClick={() => setMenuScreen("ROOT")}>‹</button><strong>Help</strong><button type="button" aria-label="Close menu" onClick={closeMenu}>×</button></header><a href="/space-hulk-death-angel-pwa/rules/death-angel-rulebook.pdf" target="_blank" rel="noreferrer" onClick={closeMenu}><strong>Rules reference</strong></a><button type="button" onClick={() => { onDownloadSave(); closeMenu(); }}><strong>Download diagnostics</strong></button><button type="button" onClick={() => { composeEmail("Space Marine: Death Angel Feedback"); closeMenu(); }}><strong>Send Feedback</strong></button><button type="button" onClick={() => { onDownloadSave(); composeEmail(`Space Hulk: Death Angel Bug Report v${APP_VERSION}`, "Please attach the diagnostics .json file that was just downloaded, then describe what happened."); closeMenu(); }}><strong>Report a Bug</strong></button></section>}</div>}</div></div>
        </div>

        {missionInfoCollapsed ? (
          <TacticalButton type="button" className={`lab-hud-tray lab-mission-tray inspectable ${tutorialTarget === "mission" ? "is-tutorial-focus" : ""}`} onTap={() => setMissionInfoCollapsed(false)} onHold={() => onInspect(locationInspection)} onHover={(anchor) => onHoverInspect(locationInspection, anchor)} onHoverEnd={onDismissHoverInspection} aria-label="Expand mission information">
            <b><i>Left blips</i>{leftBlips}</b><div className="lab-mission-tray-copy"><strong>{currentLocation?.name ?? setupLocationName(componentDefinitionId(session, state.currentLocationInstanceId))}</strong>{lastEvent && <small>Event · {lastEvent.name}</small>}</div><b><i>Right blips</i>{rightBlips}</b><em>⌄</em>
          </TacticalButton>
        ) : (
          <div className="lab-hud-expanded-panel">
            <div className="lab-location-frame">
              <div className="lab-blip-counter lab-blip-left"><span>Blips</span><strong>{leftBlips}</strong><em>Left</em></div>
              <TacticalButton type="button" className="lab-location-card inspectable" onHold={() => onInspect(locationInspection)} onHover={(anchor) => onHoverInspect(locationInspection, anchor)} onHoverEnd={onDismissHoverInspection}>
                <span>Current location <b>{currentLocation?.tier ?? "Setup"}</b></span>
                <h2>{currentLocation?.name ?? setupLocationName(componentDefinitionId(session, state.currentLocationInstanceId))}</h2>
                <strong>{locationInspection.meta ?? "Location"}</strong><p>{locationInspection.body}</p><i className="lab-hud-rivet lab-rivet-one" /><i className="lab-hud-rivet lab-rivet-two" />
              </TacticalButton>
              <div className="lab-blip-counter lab-blip-right"><span>Blips</span><strong>{rightBlips}</strong><em>Right</em></div>
            </div>

            {lastEvent && lastEventId && <TacticalButton type="button" className="lab-event-card lab-event-card-simple inspectable" onTap={() => setMissionInfoCollapsed(true)} onHold={() => onInspect(sourceInspection(session, lastEventId)!)} onHover={(anchor) => onHoverInspect(sourceInspection(session, lastEventId)!, anchor)} onHoverEnd={onDismissHoverInspection}>
              <div className="lab-event-heading"><span>{state.phase === "EVENT" ? "Event resolving" : "Current event"}</span><h3>{lastEvent.name}</h3><em className="lab-panel-collapse-cue">Tap to minimize ⌃</em></div>
              <p>{lastEvent.sourceText}</p>
            </TacticalButton>}
          </div>
        )}
      </section>

      {tutorial && tutorialIntroStep < 0 && <TutorialCoach session={session} />}

      <LiveFormationBoard desktopBoardScale={desktopBoardScale} tutorialFocus={tutorialTarget === "board"} travelStage={travelStage} session={session} boardAnimation={boardAnimation} highlightedTerrainIds={new Set(resolutionNotice?.terrainIds ?? [])} targetIds={targetIds} selectedMoveMarineId={selectedMoveMarineId} selectedStrategizeSwarmId={selectedStrategizeSwarmId} selectedDoorSwarmId={selectedDoorSwarmId} selectedHeroicChargeSwarmId={selectedHeroicChargeSwarmId} selectedEventSlaySwarmId={selectedEventSlaySwarmId} heroicChargeSlay={heroicChargeSlay} strategizeSwarms={strategizeSwarmSet} onChooseOption={onChooseOption} onInspect={onInspect} onHoverInspect={onHoverInspect} onDismissHoverInspection={onDismissHoverInspection} onSelectMoveMarine={(marineId) => { if (decision) setMoveSelection({ decisionId: decision.id, marineId }); }} onSelectStrategizeSwarm={(swarmId) => { if (decision) setStrategizeSelection({ decisionId: decision.id, swarmId }); }} onSelectDoorSwarm={(swarmId) => { if (decision) setDoorSwarmSelection({ decisionId: decision.id, swarmId }); }} onSelectHeroicChargeSwarm={(swarmId) => { if (decision) setHeroicChargeSwarmSelection({ decisionId: decision.id, swarmId }); }} onSelectEventSlaySwarm={(swarmId) => { if (decision) setEventSlaySwarmSelection({ decisionId: decision.id, swarmId }); }} />

      {!travelStage && <section className={`round-command-tray is-${displayedBottomView} ${choosingActions ? "is-choosing" : ""} ${tutorialTarget === "cards" ? "is-tutorial-focus" : ""}`}>
        {choosingActions ? <LiveActionSelection session={session} onChooseOption={onChooseOption} tutorialGuide={activeTutorialGuide} /> : <div className="round-command-viewport" onPointerDown={startTraySwipe} onPointerUp={finishTraySwipe} onPointerCancel={() => { traySwipeStart.current = null; }}><div className={`round-command-rail is-${displayedBottomView}`}>
          <div className="round-rail-panel round-rail-cards"><div className="round-rail-content"><LiveActionSelection compact session={session} onChooseOption={onChooseOption} tutorialGuide={activeTutorialGuide} /></div><button type="button" className="round-rail-tab" aria-label="Show information panel" onClick={() => setTrayView("status")}>Info</button></div>
          <div className="round-rail-panel round-rail-status"><button type="button" className="round-rail-tab" aria-label="Show selected action cards" onClick={() => setTrayView("cards")}>Cards</button><div className="round-rail-content"><section className="command-dock" aria-live="polite">
        {resolutionNotice?.presentation === "board" ? (
          <SpawnResolutionTray notice={resolutionNotice} onProceed={onDismissResolutionNotice} />
        ) : <>
        {state.activeDie && <DiePanel value={state.activeDie.modifiedValue} skull={state.activeDie.skull} purpose={state.activeDie.purpose} rerolls={state.activeDie.rerolls.length} />}
        {decision ? (
          <div className={`dock-decision ${decisionAction ? `team-context team-${decisionAction.team.toLowerCase()}` : ""}`}>
            <div className={`decision-brief ${decisionAction ? "has-action" : ""}`}>{decisionAction ? <strong>{decisionBrief}</strong> : <span>{decisionBrief}</span>}</div>
            {decisionRules && <div className="decision-rules"><strong>Artefact ability</strong><span>{decisionRules}</span></div>}
            {decisionText && <p>{decisionText}</p>}
            {decision.type === "STRATEGIZE" && selectedStrategizeSwarmId && <button type="button" className="strategize-reset" onClick={() => setStrategizeSelection(null)}>Choose another swarm</button>}
            {decision.type !== "FORWARD_SCOUTING_ORDER" && (decision.type !== "ATTACK_SLAY" || heroicChargeSlay) && orderedDockOptions.length > 0 && <div className={`dock-options ${decision.type === "STEALTH_FIRST" ? "is-stealth-first" : ""} ${orderedDockOptions.length === 1 ? "is-single-option" : ""}`}>{orderedDockOptions.map((option) => { const presentation = presentedDecisionOption(decision, option); const label = conciseDecisionButtonLabel(decision, option); return <button key={option.id} type="button" className={option.payload.skip || option.payload.stop ? "is-decline" : ""} onClick={() => onChooseOption(option.id)}><strong>{label}</strong>{presentation.preview && <small>{presentation.preview}</small>}</button>; })}</div>}
          </div>
        ) : state.status === "IN_PROGRESS" ? (
          <div className="mission-result engine-paused"><strong>Engine paused</strong><span>Download a save from the game menu before ending this mission.</span></div>
        ) : (
          <div className="mission-result"><strong>{state.status === "VICTORY" ? "Mission accomplished" : "Squad eliminated"}</strong><button type="button" onClick={onNewMission}>Start new mission</button></div>
        )}
        {error && <p className="error-message" role="alert">{error}</p>}
        </>}
      </section></div></div></div></div>}
      </section>}

      {inspection && <InspectionDrawer inspection={inspection} onClose={onDismissInspection} />}
      {hoverInspection && <DesktopInspectionTooltip inspection={hoverInspection} />}
      {resolutionNotice?.presentation === "movement" || resolutionNotice?.presentation === "board" ? null : resolutionNotice && <ResolutionNoticeOverlay notice={resolutionNotice} onProceed={onDismissResolutionNotice} />}
      {decision?.type === "FORWARD_SCOUTING_ORDER" && (scoutingPreviewVisible
        ? <ForwardScoutingPreview session={session} decision={decision} onChooseOption={onChooseOption} onViewBoard={() => setScoutingPreviewVisible(false)} />
        : <button type="button" className="scouting-return" onClick={() => setScoutingPreviewVisible(true)}><span aria-hidden="true">↩</span><strong>Forward Scouting</strong><small>Return to event choice</small></button>)}
      {decision?.type === "ATTACK_SLAY" && !heroicChargeSlay && !slayChoiceAnimating && <SlaySwarmOverlay session={session} decision={decision} onChooseOption={onChooseOption} />}
      {heroicChargeSlay && selectedHeroicChargeSwarmId && <SlaySwarmOverlay session={session} decision={decision!} swarmId={selectedHeroicChargeSwarmId} onChooseOption={onChooseOption} />}
      {tutorialIntroStep >= 0 && <TutorialHudTour step={tutorialIntroStep} onAdvance={() => setTutorialIntroStep((current) => current >= TUTORIAL_HUD_TOUR.length - 1 ? -1 : current + 1)} onSkip={() => setTutorialIntroStep(-1)} />}
      {decision?.type === "DOOR_TRAVEL_SLAY" && selectedDoorSwarmId && <SlaySwarmOverlay session={session} decision={decision} swarmId={selectedDoorSwarmId} onChooseOption={onChooseOption} />}
      {(decision?.type === "EVENT_SLAY" || decision?.type === "INTIMIDATION_PICK") && selectedEventSlaySwarmId && <SlaySwarmOverlay session={session} decision={decision} swarmId={selectedEventSlaySwarmId} onChooseOption={onChooseOption} />}
      {rollNotice && <RollResult key={rollNotice.id} notice={rollNotice} decision={rollDecision} onProceed={onDismissRoll} />}
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
    const terrains = slot.terrainInstanceIds[side].flatMap((terrainId) => {
      const definition = data.definitions.terrain.find((item) => item.id === componentDefinitionId(session, terrainId));
      return definition ? [{ name: definition.name, color: labSpawnColor(definition.spawnColor), supportTokens: state.terrain[terrainId]?.support ?? 0 }] : [];
    });
    const swarms = slot.swarmIds[side].map((swarmId) => state.swarms[swarmId]).filter((swarm): swarm is NonNullable<typeof swarm> => Boolean(swarm));
    const icons = swarms.flatMap((swarm) => swarm.cardIds.map((cardId) => state.genestealers[cardId]?.icon).filter((icon): icon is GenestealerIcon => Boolean(icon)));
    const broodLords = swarms.reduce((total, swarm) => total + swarm.broodLordIds.length, 0);
    return {
      terrain: terrains[0],
      terrains,
      swarm: icons.length || broodLords ? { icons, broodLords: broodLords || undefined } : undefined,
    };
  };
  return state.formation.map((slot, positionIndex) => {
    const marineDefinition = data.definitions.marines.find((item) => item.id === componentDefinitionId(session, slot.marineInstanceId));
    const namedAction = marineDefinition?.namedActionAbility ? data.definitions.actions.find((item) => item.team === marineDefinition.team && item.name === marineDefinition.namedActionAbility) : undefined;
    const marine = state.marines[slot.marineInstanceId];
    return {
      left: flank(positionIndex, "LEFT"),
      marine: { name: marineDefinition ? shortMarineName(marineDefinition.name) : slot.marineInstanceId, team: marineDefinition?.team ?? "GREY", facing: marine?.facing ?? "LEFT", range: marineDefinition?.attackRange, ability: namedAction?.name, abilityText: namedAction?.sourceText, supportTokens: marine?.support ?? 0 },
      right: flank(positionIndex, "RIGHT"),
    };
  });
}

function LiveFormationBoard({ desktopBoardScale, tutorialFocus = false, session, travelStage, boardAnimation, highlightedTerrainIds, targetIds, selectedMoveMarineId, selectedStrategizeSwarmId, selectedDoorSwarmId, selectedHeroicChargeSwarmId, selectedEventSlaySwarmId, heroicChargeSlay, strategizeSwarms: selectableStrategizeSwarms, onChooseOption, onInspect, onHoverInspect, onDismissHoverInspection, onSelectMoveMarine, onSelectStrategizeSwarm, onSelectDoorSwarm, onSelectHeroicChargeSwarm, onSelectEventSlaySwarm }: { desktopBoardScale: DesktopBoardScale; tutorialFocus?: boolean; session: EngineSession; travelStage: TravelStage | null; boardAnimation: BoardAnimation | null; highlightedTerrainIds: Set<string>; targetIds: Set<string>; selectedMoveMarineId: string | null; selectedStrategizeSwarmId: string | null; selectedDoorSwarmId: string | null; selectedHeroicChargeSwarmId: string | null; selectedEventSlaySwarmId: string | null; heroicChargeSlay: boolean; strategizeSwarms: Set<string>; onChooseOption: (optionId: string) => void; onInspect: (inspection: Inspection) => void; onHoverInspect: (inspection: Inspection, anchor: DOMRect) => void; onDismissHoverInspection: () => void; onSelectMoveMarine: (marineId: string) => void; onSelectStrategizeSwarm: (swarmId: string) => void; onSelectDoorSwarm: (swarmId: string) => void; onSelectHeroicChargeSwarm: (swarmId: string) => void; onSelectEventSlaySwarm: (swarmId: string) => void }) {
  const { state } = session;
  const boardScale = useBoardScale(desktopBoardScale);
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
    if (decision.type === "PLACE_ARTEFACT") return decision.legalOptions.flatMap((option) => {
      const row = typeof option.payload.positionIndex === "number" ? option.payload.positionIndex : null;
      const side = option.payload.side === "LEFT" || option.payload.side === "RIGHT" ? option.payload.side : null;
      return row === null || side === null ? [] : [{ label: "Place Artefact here", row, side, state: "destination" }];
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
    const underAttack = boardAnimation?.swarmAnimation === "attack" && boardAnimation.swarmId && state.swarms[boardAnimation.swarmId]?.positionIndex === positionIndex;
    return [name, underAttack ? "targeted" : selectedMoveMarineId === marineId ? "selected" : selectable ? "selectable" : targeted ? "targeted" : "neutral"];
  })), [boardAnimation, decision, rows, selectedMoveMarineId, state.formation, state.swarms, targetIds]);
  const swarmStates = useMemo<Record<string, LabTargetState>>(() => Object.fromEntries(state.formation.flatMap((slot, positionIndex) => (["LEFT", "RIGHT"] as const).map((side) => {
    const swarmId = slot.swarmIds[side][0];
    const selectable = decision?.type === "STRATEGIZE" && !selectedStrategizeSwarmId && Boolean(swarmId && selectableStrategizeSwarms.has(swarmId));
    const selected = Boolean(swarmId && selectedStrategizeSwarmId === swarmId);
    const targeted = Boolean(swarmId && targetIds.has(swarmId));
    const attacking = Boolean(swarmId && swarmId === boardAnimation?.swarmId && boardAnimation?.swarmAnimation === "attack");
    const doorSelectable = decision?.type === "DOOR_TRAVEL_SLAY" && Boolean(swarmId && targetIds.has(swarmId));
    const heroicChargeSelectable = heroicChargeSlay && Boolean(swarmId && targetIds.has(swarmId));
    const eventSlaySelectable = (decision?.type === "EVENT_SLAY" || decision?.type === "INTIMIDATION_PICK") && Boolean(swarmId && targetIds.has(swarmId));
    return [cellKey(positionIndex, side), attacking ? "targeted" : selected || selectedDoorSwarmId === swarmId || selectedHeroicChargeSwarmId === swarmId || selectedEventSlaySwarmId === swarmId ? "selected" : selectable || doorSelectable || heroicChargeSelectable || eventSlaySelectable ? "selectable" : targeted ? "targeted" : "neutral"];
  }))), [boardAnimation, decision, heroicChargeSlay, selectedDoorSwarmId, selectedEventSlaySwarmId, selectedHeroicChargeSwarmId, selectedStrategizeSwarmId, selectableStrategizeSwarms, state.formation, targetIds]);
  const terrainStates = useMemo<Record<string, LabTargetState>>(() => Object.fromEntries(state.formation.flatMap((slot, positionIndex) => (["LEFT", "RIGHT"] as const).map((side) => {
    const terrainId = slot.terrainInstanceIds[side][0];
    const isTargeted = Boolean(terrainId && (targetIds.has(terrainId) || highlightedTerrainIds.has(terrainId)));
    // A Terrain choice must sit above an engaged swarm so its button receives
    // the tap. Other Terrain highlights remain underneath the swarm artwork.
    return [cellKey(positionIndex, side), isTargeted ? decision?.type === "ACTIVATE_TERRAIN" ? "selectable" : "targeted" : "neutral"];
  }))), [decision, highlightedTerrainIds, state.formation, targetIds]);
  const marineAnimationStates = useMemo(() => {
    const marineId = boardAnimation?.marineId;
    const animation = boardAnimation?.marineAnimation;
    if (!marineId || !animation) return {};
    const definition = data.definitions.marines.find((item) => item.id === componentDefinitionId(session, marineId));
    return definition ? { [shortMarineName(definition.name)]: animation } : {};
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
    // Genestealer attacks are resolved in deterministic queue order. The
    // board highlights the current matchup, but it is not an input choice.
    if (decision.type === "GENESTEALER_ATTACK_ACK") return;
    if (decision.type === "STRATEGIZE" && !selectedStrategizeSwarmId && selectableStrategizeSwarms.has(swarmId)) { onSelectStrategizeSwarm(swarmId); return; }
    if (decision.type === "DOOR_TRAVEL_SLAY" && targetIds.has(swarmId)) { onSelectDoorSwarm(swarmId); return; }
    if (heroicChargeSlay && targetIds.has(swarmId)) { onSelectHeroicChargeSwarm(swarmId); return; }
    if ((decision.type === "EVENT_SLAY" || decision.type === "INTIMIDATION_PICK") && targetIds.has(swarmId)) { onSelectEventSlaySwarm(swarmId); return; }
    const option = uniquePayloadOption(decision, "swarmId", swarmId);
    if (option) onChooseOption(option.id);
  };
  const chooseMarine = (name: string) => {
    const row = rows.findIndex((item) => item.marine.name === name);
    const marineId = row >= 0 ? state.formation[row].marineInstanceId : null;
    if (!decision || !marineId) return;
    if (decision.type === "GENESTEALER_ATTACK_ACK") return;
    if (decision.type === "MOVE_MARINE" && decision.legalOptions.some((option) => option.payload.marineId === marineId)) { onSelectMoveMarine(marineId); return; }
    const option = uniquePayloadOption(decision, "marineId", marineId);
    if (option) onChooseOption(option.id);
  };
  const chooseTerrain = (row: number, side: Side) => {
    const terrainId = state.formation[row].terrainInstanceIds[side][0];
    const option = terrainId ? uniquePayloadOption(decision, "terrainId", terrainId) : null;
    if (option) onChooseOption(option.id);
  };
  // The physical formation closes ranks after casualties, but the mobile board
  // itself is always a six-lane viewport. Keep the corridor, floor route, and
  // touch geometry stable while distributing the surviving Marines across it.
  const liveStyle = { "--lab-scale": boardScale.toFixed(3), "--lab-viewport": "1180px", "--lab-row-count": String(Math.max(rows.length, 1)) } as CSSProperties;
  const locationProgress = data.definitions.locations.find((item) => item.id === componentDefinitionId(session, state.currentLocationInstanceId))?.tier ?? "1";
  return <section className={`live-sprite-board travel-live-board ${travelStage ? `is-${travelStage}` : ""} ${tutorialFocus ? "is-tutorial-focus" : ""}`} style={liveStyle}><FormationBoard key={state.currentLocationInstanceId} rows={rows} locationProgress={locationProgress} marineSpriteUrl="prototype-art/marine-idle.gif" marineDeathStripUrl="game-art/marine/death.png" marineDodgeStripUrl="game-art/marine/dodge.png" marineFireStripUrls={{ straight: "game-art/marine/fire-straight.png", up: "game-art/marine/fire-up.png", down: "game-art/marine/fire-down.png" }} marineJamStripUrls={{ straight: "game-art/marine/gun-jam-straight.png", up: "game-art/marine/gun-jam-up.png", down: "game-art/marine/gun-jam-down.png" }} alienSpriteUrl="prototype-art/alien-attack.gif" alienAttackStripUrl="game-art/genestealer/attack.png" alienDeathStripUrl="game-art/genestealer/death.png" alienIdleStripUrl="game-art/genestealer/idle.png" broodlordSpriteUrl="game-art/broodlord/idle.png" broodlordAttackStripUrl="game-art/broodlord/attack.png" broodlordDeathStripUrl="game-art/broodlord/death.png" terrainSpriteUrls={{ Corridor: "game-art/terrain/corridor-v1.png", Artefact: "game-art/terrain/artefact-v1.png", "Control Panel": "game-art/terrain/control-panel-v1.png", Door: "game-art/terrain/door-v1.png", "Promethium Tank": "game-art/terrain/promethium-tank-v1.png", "Dark Corner": "game-art/terrain/dark-corner-v1.png", "Spore Chimney": "game-art/terrain/spore-chimney-v1.png", "Ventilation Duct": "game-art/terrain/ventilation-duct-v1.png" }} movingSwarmCells={boardAnimation?.movingSwarmCells} marineAnimationStates={marineAnimationStates} swarmAnimationStates={swarmAnimationStates} marineStates={marineStates} marineMoveChoices={marineMoveChoices} overlayChoices={overlayChoices} swarmStates={swarmStates} terrainStates={terrainStates} selectedMarine={null} onSelectMarine={chooseMarine} onSelectSwarm={chooseSwarm} onSelectTerrain={chooseTerrain} onOverlayChoice={(choice) => chooseCellOption(choice.row, choice.side)} onMarineMoveChoice={(choice) => { const option = decision?.legalOptions.find((item) => item.payload.marineId === selectedMoveMarineId && item.payload.to === choice.row); if (option) onChooseOption(option.id); }} onInspect={(details) => onInspect({ eyebrow: details.eyebrow, title: details.title, body: details.body, meta: details.subtitle })} onHoverInspect={(details, anchor) => onHoverInspect({ eyebrow: details.eyebrow, title: details.title, body: details.body, meta: details.subtitle }, anchor)} onDismissHoverInspection={onDismissHoverInspection} /><div className="travel-live-blackout" aria-hidden="true" /></section>;
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
        <strong>{shortMarineName(marineDefinition.name)}</strong>
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

function DesktopInspectionTooltip({ inspection }: { inspection: HoverInspection }) {
  const viewportWidth = globalThis.innerWidth;
  const viewportHeight = globalThis.innerHeight;
  const width = Math.min(640, viewportWidth - 42);
  const topReserve = 82;
  const bottomReserve = 112;
  const height = 154;
  const laneCenters = [topReserve + height / 2, topReserve + (viewportHeight - topReserve - bottomReserve) * .36, topReserve + (viewportHeight - topReserve - bottomReserve) * .64, viewportHeight - bottomReserve - height / 2];
  const sourceCenter = (inspection.anchor.top + inspection.anchor.bottom) / 2;
  const laneTops = laneCenters.map((center) => Math.max(topReserve, Math.min(viewportHeight - bottomReserve - height, center - height / 2)));
  const safeLaneTops = laneTops.filter((top) => top > inspection.anchor.bottom + 10 || top + height < inspection.anchor.top - 10);
  const top = [...(safeLaneTops.length ? safeLaneTops : laneTops)].sort((left, right) => Math.abs(left + height / 2 - sourceCenter) - Math.abs(right + height / 2 - sourceCenter))[0];
  const sourceAbove = inspection.anchor.bottom < top;
  const arrowX = Math.max(24, Math.min(width - 24, (inspection.anchor.left + inspection.anchor.right) / 2 - (viewportWidth - width) / 2));
  return <aside className={`desktop-inspection-tooltip is-source-${sourceAbove ? "above" : "below"}`} style={{ "--inspection-top": `${top}px`, "--inspection-arrow-x": `${arrowX}px` } as CSSProperties} aria-live="polite"><span>{inspection.eyebrow}</span><h2>{inspection.title}</h2>{inspection.meta && <strong>{inspection.meta}</strong>}<p>{inspection.body}</p></aside>;
}

function ResolutionNoticeOverlay({ notice, onProceed }: { notice: ResolutionNotice; onProceed: () => void }) {
  return <div className="resolution-notice-backdrop" role="presentation"><section className={`resolution-notice ${notice.team ? `team-${notice.team.toLowerCase()}` : ""}`} role="dialog" aria-modal="true" aria-labelledby={`resolution-${notice.id}`}>
    <span>{notice.eyebrow}</span><h2 id={`resolution-${notice.id}`}>{notice.title}</h2>{notice.meta && <strong>{notice.meta}</strong>}<p>{notice.body}</p><button type="button" onClick={onProceed}>Proceed</button>
  </section></div>;
}

function SpawnResolutionTray({ notice, onProceed }: { notice: ResolutionNotice; onProceed: () => void }) {
  return <div className="dock-decision spawn-resolution-tray"><div className="decision-brief"><span>{notice.title}</span></div><div className="dock-options is-single-option"><button type="button" onClick={onProceed}><strong>Begin movement</strong></button></div></div>;
}

function SlaySwarmOverlay({ decision, onChooseOption, session, swarmId: onlySwarmId }: { decision: PendingDecision; onChooseOption: (optionId: string) => void; session: EngineSession; swarmId?: string }) {
  const groups = new Map<string, DecisionOption[]>();
  let stopOption: DecisionOption | null = null;
  for (const option of decision.legalOptions) {
    if (option.payload.stop === true) { stopOption = option; continue; }
    const swarmId = typeof option.payload.swarmId === "string" ? option.payload.swarmId : decision.type === "INTIMIDATION_PICK"
      ? Object.values(session.state.swarms).find((swarm) => swarm.cardIds.includes(option.payload.cardId as string))?.id
      : undefined;
    if (typeof swarmId !== "string") continue;
    groups.set(swarmId, [...(groups.get(swarmId) ?? []), option]);
  }
  const doorAbility = decision.type === "DOOR_TRAVEL_SLAY";
  const heroicCharge = decision.type === "ATTACK_SLAY" && session.state.actionStep === "HEROIC_CHARGE_SLAY";
  const eventEffect = decision.type === "EVENT_SLAY" || decision.type === "INTIMIDATION_PICK";
  return (
    <div className="slay-swarm-backdrop" role="presentation">
      <section className="slay-swarm-overlay" role="dialog" aria-modal="true" aria-labelledby="slay-swarm-title">
        <header><span>{doorAbility ? "Door support" : heroicCharge ? "Heroic Charge" : decision.type === "INTIMIDATION_PICK" ? "Intimidation" : eventEffect ? "Event effect" : "Attack confirmed"}</span><h2 id="slay-swarm-title">{decision.type === "INTIMIDATION_PICK" ? "Choose a Genestealer to intimidate" : "Choose a Genestealer to slay"}</h2><p>{doorAbility || heroicCharge || eventEffect ? "Choose one Genestealer from the selected swarm." : "Tap its icon in the zoomed swarm."}</p></header>
        {[...groups.entries()].filter(([swarmId]) => !onlySwarmId || swarmId === onlySwarmId).map(([swarmId, options]) => {
          const swarm = session.state.swarms[swarmId];
          const location = swarm ? `Formation ${swarm.positionIndex + 1} · ${swarm.side.toLowerCase()}` : "Target swarm";
          return <section key={swarmId} className="slay-swarm-group" aria-label={`${location} swarm`}>
            <div className="slay-swarm-zoom"><i aria-hidden="true" /><span>{location}</span><b>{options.length} target{options.length === 1 ? "" : "s"}</b></div>
            <div className="slay-icon-grid">{options.map((option) => {
              const cardId = option.payload.cardId;
              const isBroodlord = typeof cardId === "string" && Boolean(session.state.swarms[swarmId]?.broodLordIds.includes(cardId));
              const icon = typeof cardId === "string" ? session.state.genestealers[cardId]?.icon : undefined;
              const label = isBroodlord ? "Brood Lord" : icon ? ICON_LABELS[icon] : "Genestealer";
              return <button key={option.id} type="button" className={isBroodlord ? "is-broodlord" : ""} onClick={() => onChooseOption(option.id)} aria-label={`Slay ${label}`}><i aria-hidden="true">{isBroodlord ? "♛" : icon ? ICON_GLYPHS[icon] : "◉"}</i><strong>{label}</strong><small>Slay</small></button>;
            })}</div>
          </section>;
        })}
        {stopOption && <button type="button" className="slay-stop" onClick={() => onChooseOption(stopOption.id)}>{doorAbility ? "End Door ability" : "Stop slaying"}</button>}
      </section>
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

function RollResult({ decision, notice, onProceed }: { decision: PendingDecision | null; notice: RollNotice; onProceed: (optionId?: string) => void }) {
  const finalFace = combatDieFace(notice.value);
  const cubeStyle = {
    "--die-final": ({ 0: "rotateX(90deg) rotateY(0deg)", 1: "rotateX(0deg) rotateY(-90deg)", 2: "rotateX(0deg) rotateY(0deg)", 3: "rotateX(-90deg) rotateY(0deg)", 4: "rotateX(0deg) rotateY(90deg)", 5: "rotateX(0deg) rotateY(180deg)" } as const)[finalFace.value],
  } as CSSProperties;
  const reduceMotion = useMemo(() => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false, []);
  const settleTimer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const [rolling, setRolling] = useState(!reduceMotion);

  const clearRollTimer = () => {
    if (settleTimer.current !== null) globalThis.clearTimeout(settleTimer.current);
    settleTimer.current = null;
  };

  const settleRoll = () => {
    clearRollTimer();
    setRolling(false);
  };

  useEffect(() => {
    if (reduceMotion) return clearRollTimer;
    settleTimer.current = globalThis.setTimeout(() => {
      clearRollTimer();
      setRolling(false);
    }, 1680);
    return clearRollTimer;
  }, [notice.id, reduceMotion]);

  return (
    <div className="roll-backdrop" role="presentation">
      <section className={`roll-result is-${notice.placement} ${decision ? "has-follow-up" : ""} ${rolling ? "is-rolling" : "is-settled"}`} role="dialog" aria-modal="true" aria-labelledby="roll-title">
        <span>{notice.reroll ? "Die rerolled" : "Die rolled"}</span>
        <h2 id="roll-title">{notice.title}</h2>
        <div className="roll-stage" aria-live="polite">
          <div className="roll-cube" style={cubeStyle} data-rolling={rolling || undefined} aria-label={rolling ? "Combat die rolling" : `Combat die result ${finalFace.value}${finalFace.skull ? ", skull" : ""}`}>
            {([2, 5, 1, 4, 3, 0] as const).map((value, index) => { const face = combatDieFace(value); return <span key={value} className={["face-front", "face-back", "face-right", "face-left", "face-top", "face-bottom"][index]}><strong>{value}</strong>{face.skull && <i aria-hidden="true">💀︎</i>}</span>; })}
          </div>
        </div>
        <p>{rolling ? "Rolling…" : notice.outcome}</p>
        {rolling ? <button type="button" onClick={settleRoll}>Skip roll</button> : decision ? <div className="roll-result-actions"><span>Keep this result or spend Support to reroll?</span>{decision.legalOptions.map((option) => <button key={option.id} type="button" onClick={() => onProceed(option.id)}>{option.payload.reroll === true ? "Reroll" : "Keep result"}</button>)}</div> : <button type="button" onClick={() => onProceed()}>Proceed</button>}
      </section>
    </div>
  );
}
