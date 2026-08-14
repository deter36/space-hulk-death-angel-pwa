"use client";

import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes } from "react";
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
  type PendingDecision,
} from "@/src/engine";
import type { GenestealerIcon, Side, TeamColor } from "@/src/data/types";
import { EngineSessionStallError, settleEngineSession } from "@/src/ui-adapter/session-settler";

type Definition = { id: string; name: string };
type MarineDefinition = Definition & { team: TeamColor; attackRange: number; namedActionAbility: string | null };
type ActionDefinition = Definition & { team: TeamColor; initiative: number; type: string; sourceText: string };
type TerrainDefinition = Definition & { spawnColor: string; activatable: boolean; sourceText: string | null };
type LocationDefinition = Definition & { tier: string; leftBlips: number; rightBlips: number; abilityTiming: string | null; sourceText: string | null };
type SetupLocationDefinition = Definition;
type EventDefinition = Definition & { copyIndex: number | null; sourceText: string; movementIcon: GenestealerIcon | null; movement: string | null };
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

function formatTransition(kind: string): string {
  return kind.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
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
  if (marine) return { eyebrow: `${marine.team} combat team`, title: marine.name, body: marine.namedActionAbility ? `Named ability: ${marine.namedActionAbility}. See that team's Action card for the complete ability text.` : "No named Action-card ability.", meta: `Attack range ${marine.attackRange}` };
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
  for (const key of ["actionId", "terrainId", "cardId", "swarmId", "marineId"] as const) {
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

export default function GameClient() {
  const [selectedTeams, setSelectedTeams] = useState<TeamColor[]>([]);
  const [session, setSession] = useState<EngineSession | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diagnosticNotice, setDiagnosticNotice] = useState<string | null>(null);
  const [restoreComplete, setRestoreComplete] = useState(false);

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
      setDiagnosticNotice(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The mission could not be started.");
    }
  };

  const resolveDecision = (optionId: string) => {
    const decision = session?.state.pendingDecision;
    if (!session || !decision) return;
    try {
      const prepared = prepareUiSession(submitSessionDecision(session, decision.id, optionId));
      setSession(prepared.session);
      setInspection(null);
      setError(prepared.error);
      setDiagnosticNotice(null);
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
    setDiagnosticNotice(null);
  };

  const copyDiagnostics = async () => {
    if (!session) return;
    try {
      if (!globalThis.navigator?.clipboard) throw new Error("Clipboard access is unavailable in this browser.");
      await globalThis.navigator.clipboard.writeText(diagnosticText(session));
      setDiagnosticNotice("Diagnostic report copied.");
    } catch (caught) {
      setDiagnosticNotice(caught instanceof Error ? caught.message : "The diagnostic report could not be copied.");
    }
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
      setDiagnosticNotice("Diagnostic save downloaded.");
    } catch (caught) {
      setDiagnosticNotice(caught instanceof Error ? caught.message : "The diagnostic save could not be downloaded.");
    }
  };

  const startNewMission = () => {
    globalThis.localStorage?.removeItem(SAVED_GAME_KEY);
    setSession(null);
    setInspection(null);
    setSelectedTeams([]);
    setError(null);
    setDiagnosticNotice(null);
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

  return <MissionBoard session={session} inspection={inspection} error={error} diagnosticNotice={diagnosticNotice} onInspect={setInspection} onChooseOption={resolveDecision} onUndo={undoOne} onCopyDiagnostics={copyDiagnostics} onDownloadSave={downloadSave} onDismissInspection={() => setInspection(null)} onNewMission={startNewMission} />;
}

type MissionBoardProps = {
  session: EngineSession;
  inspection: Inspection | null;
  error: string | null;
  diagnosticNotice: string | null;
  onInspect: (inspection: Inspection) => void;
  onChooseOption: (optionId: string) => void;
  onUndo: () => void;
  onCopyDiagnostics: () => void;
  onDownloadSave: () => void;
  onDismissInspection: () => void;
  onNewMission: () => void;
};

function MissionBoard({ session, inspection, error, diagnosticNotice, onInspect, onChooseOption, onUndo, onCopyDiagnostics, onDownloadSave, onDismissInspection, onNewMission }: MissionBoardProps) {
  const { state } = session;
  const decision = state.pendingDecision;
  const targetIds = useMemo(() => pendingTargetIds(decision), [decision]);
  const currentLocation = data.definitions.locations.find((item) => item.id === componentDefinitionId(session, state.currentLocationInstanceId));
  const locationInspection = sourceInspection(session, state.currentLocationInstanceId) ?? { eyebrow: "Setup location", title: setupLocationName(componentDefinitionId(session, state.currentLocationInstanceId)), body: "Starting location for the solo mission.", meta: "Void Lock" };
  const leftBlips = state.orderedSources["blip.left"]?.length ?? 0;
  const rightBlips = state.orderedSources["blip.right"]?.length ?? 0;
  const livingMarines = state.formation.length;
  const undoStatus = getUndoStatus(session);
  const lastEventId = state.eventRuntime?.eventCardId ?? state.orderedSources["event.discard"]?.at(-1) ?? null;
  const lastEvent = lastEventId ? findEvent(lastEventId) : null;
  const recentTransitions = session.transitions.slice(-3).reverse();
  const dockOptions = decision?.legalOptions.filter((option) => !isDirectInputOption(decision, option)) ?? [];

  return (
    <main className="mission-shell">
      <header className="command-header">
        <div className="mission-brand"><span>Death Angel</span><strong>Squad Command</strong></div>
        <div className="round-block"><span>Round</span><strong>{String(state.round).padStart(2, "0")}</strong></div>
        <dl className="mission-stats">
          <div><dt>Phase</dt><dd>{formatPhase(state.phase)}</dd></div>
          <div><dt>Marines</dt><dd>{livingMarines} / 6</dd></div>
          <div><dt>Support</dt><dd><span className="support-dot">●</span> {state.supportSupply}</dd></div>
        </dl>
      </header>

      <section className="location-strip">
        <TacticalButton type="button" className="inspectable location-button" onHold={() => onInspect(locationInspection)}>
          <span><small>{currentLocation ? `Location · ${currentLocation.tier}` : "Setup location"}</small><strong>{currentLocation?.name ?? setupLocationName(componentDefinitionId(session, state.currentLocationInstanceId))}</strong></span>
          <span className="tap-hint">Hold for rules&nbsp; ⓘ</span>
        </TacticalButton>
        <div className="blip-readout"><span>Port <strong>{leftBlips}</strong></span><i aria-hidden="true"><b style={{ width: `${Math.min(leftBlips * 8, 100)}%` }} /></i><span>Starboard <strong>{rightBlips}</strong></span><i aria-hidden="true"><b style={{ width: `${Math.min(rightBlips * 8, 100)}%` }} /></i></div>
      </section>

      {lastEvent && lastEventId && (
        <TacticalButton type="button" className="event-ribbon inspectable" onHold={() => onInspect(sourceInspection(session, lastEventId)!)}>
          <span className="event-kicker">{state.phase === "EVENT" ? "Event resolving" : "Last event"}</span><strong>{lastEvent.name}</strong><span>{lastEvent.movementIcon ? `${ICON_GLYPHS[lastEvent.movementIcon]} ${ICON_LABELS[lastEvent.movementIcon]}` : "Hold for card text"} &nbsp;ⓘ</span>
        </TacticalButton>
      )}

      <section className="formation-board">
        <div className="column-labels"><span>Port threat</span><span>Formation</span><span>Starboard threat</span></div>
        {state.formation.map((slot, positionIndex) => (
          <FormationRow key={slot.marineInstanceId} session={session} positionIndex={positionIndex} targetIds={targetIds} onInspect={onInspect} onChooseOption={onChooseOption} />
        ))}
      </section>

      <section className="action-reference">
        <div className="panel-label">Combat team cards <span>Tap highlighted card · hold any card for rules</span></div>
        <div className="action-reference-grid">
          {state.activeTeams.flatMap((team) => state.teams[team].actionInstanceIds).map((actionId) => {
            const action = data.definitions.actions.find((item) => item.id === componentDefinitionId(session, actionId));
            if (!action) return null;
            const option = uniquePayloadOption(decision, "actionId", actionId);
            const chosen = state.teams[action.team].chosenActionInstanceId === actionId;
            return (
              <TacticalButton key={actionId} type="button" className={`reference-card team-${action.team.toLowerCase()} ${option ? "legal-target" : ""} ${chosen ? "is-chosen" : ""}`} onTap={option ? () => onChooseOption(option.id) : undefined} onHold={() => onInspect(sourceInspection(session, actionId)!)}>
                <span>{action.team}</span><strong>{action.name}</strong><small>Initiative {action.initiative}</small>
              </TacticalButton>
            );
          })}
        </div>
      </section>

      <section className="command-dock" aria-live="polite">
        {state.activeDie && <DiePanel value={state.activeDie.modifiedValue} skull={state.activeDie.skull} purpose={state.activeDie.purpose} rerolls={state.activeDie.rerolls.length} />}
        {decision ? (
          <div className="dock-decision">
            <div className="decision-heading"><span>{formatPhase(decision.type)}</span><strong>{decision.promptKey.replaceAll(".", " · ").replaceAll("_", " ")}</strong></div>
            <p>{decision.legalOptions.some((option) => isDirectInputOption(decision, option)) ? "Tap a highlighted card or board target. Hold any object briefly to read its rules." : "Choose an option below. The formation remains visible while you decide."}</p>
            {dockOptions.length > 0 && <div className="dock-options">{dockOptions.map((option) => <button key={option.id} type="button" onClick={() => onChooseOption(option.id)}><strong>{option.label}</strong>{option.canonicalEffectPreview && <small>{option.canonicalEffectPreview}</small>}</button>)}</div>}
          </div>
        ) : state.status === "IN_PROGRESS" ? (
          <div className="mission-result engine-paused"><strong>Engine paused</strong><span>Download the save or copy diagnostics before ending this mission.</span></div>
        ) : (
          <div className="mission-result"><strong>{state.status === "VICTORY" ? "Mission accomplished" : "Squad eliminated"}</strong><button type="button" onClick={onNewMission}>Start new mission</button></div>
        )}
        {error && <p className="error-message" role="alert">{error}</p>}
        <div className="diagnostic-tools">
          <button type="button" onClick={onCopyDiagnostics}>Copy diagnostics</button>
          <button type="button" onClick={onDownloadSave}>Download save</button>
          {diagnosticNotice && <span role="status">{diagnosticNotice}</span>}
        </div>
      </section>

      <section className="history-bar">
        <div className="history-feed">{recentTransitions.map((transition) => <span key={transition.seq}><b>{String(transition.seq).padStart(3, "0")}</b>{formatTransition(transition.type)}</span>)}</div>
        <div className="history-controls">
          <button type="button" className="new-mission-command" onClick={() => { if (globalThis.confirm("End this mission and return to team selection?")) onNewMission(); }}>New mission</button>
          <button type="button" className="undo-command" disabled={!undoStatus.allowed} onClick={onUndo}><span>↶</span><strong>Undo</strong><small>{undoStatus.allowed ? `${undoStatus.availableSteps} step${undoStatus.availableSteps === 1 ? "" : "s"} available` : undoStatus.unavailableReason === "RANDOMNESS_BARRIER" ? "Locked by random result" : undoStatus.unavailableReason === "HIDDEN_INFORMATION_BARRIER" ? "Locked by card reveal" : "No reversible step"}</small></button>
        </div>
      </section>

      {inspection && <InspectionDrawer inspection={inspection} onClose={onDismissInspection} />}
    </main>
  );
}

function FormationRow({ session, positionIndex, targetIds, onInspect, onChooseOption }: { session: EngineSession; positionIndex: number; targetIds: Set<string>; onInspect: (inspection: Inspection) => void; onChooseOption: (optionId: string) => void }) {
  const { state } = session;
  const decision = state.pendingDecision;
  const slot = state.formation[positionIndex];
  const marine = state.marines[slot.marineInstanceId];
  const marineDefinition = data.definitions.marines.find((item) => item.id === componentDefinitionId(session, slot.marineInstanceId))!;
  const marineOption = uniquePayloadOption(decision, "marineId", slot.marineInstanceId);
  const rowOption = uniquePayloadOption(decision, "to", positionIndex) ?? uniquePayloadOption(decision, "positionIndex", positionIndex);
  const tapOption = marineOption ?? rowOption;
  return (
    <div className={`formation-row ${targetIds.has(`position:${positionIndex}`) ? "legal-row" : ""}`}>
      <Flank session={session} positionIndex={positionIndex} side="LEFT" onInspect={onInspect} onChooseOption={onChooseOption} />
      <TacticalButton type="button" className={`marine-card inspectable team-${marineDefinition.team.toLowerCase()} ${tapOption ? "legal-target" : ""}`} onTap={tapOption ? () => onChooseOption(tapOption.id) : undefined} onHold={() => onInspect(sourceInspection(session, slot.marineInstanceId)!)}>
        <span className="marine-facing" aria-label={`Facing ${marine.facing}`}>{marine.facing === "LEFT" ? "◀" : "▶"}</span>
        <span className="marine-team">{marineDefinition.team} team</span>
        <strong>{marineDefinition.name}</strong>
        <span className="marine-stats"><b>◎ Range {marineDefinition.attackRange}</b><i>{marine.support ? `${"●".repeat(marine.support)} support` : "No support"}</i></span>
      </TacticalButton>
      <Flank session={session} positionIndex={positionIndex} side="RIGHT" onInspect={onInspect} onChooseOption={onChooseOption} />
    </div>
  );
}

function Flank({ session, positionIndex, side, onInspect, onChooseOption }: { session: EngineSession; positionIndex: number; side: Side; onInspect: (inspection: Inspection) => void; onChooseOption: (optionId: string) => void }) {
  const slot = session.state.formation[positionIndex];
  const decision = session.state.pendingDecision;
  const terrainIds = slot.terrainInstanceIds[side];
  const swarmIds = slot.swarmIds[side];
  const positionOption = uniquePayloadOption(decision, "positionIndex", positionIndex, side) ?? uniquePayloadOption(decision, "to", positionIndex);
  return (
    <div className={`flank-cell ${positionOption ? "legal-target" : ""}`}>
      {positionOption && <button type="button" className="flank-position-input" aria-label={`Choose formation position ${positionIndex + 1}, ${side.toLowerCase()} side`} onClick={() => onChooseOption(positionOption.id)} />}
      <div className="terrain-stack">
        {terrainIds.map((terrainId) => {
          const terrain = data.definitions.terrain.find((item) => item.id === componentDefinitionId(session, terrainId));
          if (!terrain) return null;
          const option = uniquePayloadOption(decision, "terrainId", terrainId);
          return <TacticalButton key={terrainId} type="button" className={`terrain-chip inspectable ${option ? "legal-target" : ""}`} onTap={option ? () => onChooseOption(option.id) : undefined} onHold={() => onInspect(sourceInspection(session, terrainId)!)} stopPropagation><span>{terrain.name}</span><i>ⓘ</i>{session.state.terrain[terrainId]?.support > 0 && <b>{"●".repeat(session.state.terrain[terrainId].support)}</b>}</TacticalButton>;
        })}
      </div>
      <div className="swarm-stack">
        {swarmIds.flatMap((swarmId) => {
          const swarm = session.state.swarms[swarmId];
          if (!swarm) return [];
          return swarm.cardIds.map((cardId) => {
            const icon = session.state.genestealers[cardId].icon;
            const option = uniquePayloadOption(decision, "cardId", cardId) ?? uniquePayloadOption(decision, "swarmId", swarmId);
            return <TacticalButton key={cardId} type="button" className={`genestealer-icon ${option ? "legal-target" : ""}`} aria-label={`${ICON_LABELS[icon]} Genestealer. Hold to inspect.`} onTap={option ? () => onChooseOption(option.id) : undefined} onHold={() => onInspect({ eyebrow: `Genestealer · ${side.toLowerCase()} swarm`, title: ICON_LABELS[icon], body: `A ${ICON_LABELS[icon].toLowerCase()} Genestealer in a swarm of ${swarm.cardIds.length + swarm.broodLordIds.length}.`, meta: `Formation position ${positionIndex + 1}${session.state.genestealers[cardId].movedOrFlankedThisEvent ? " · moved this event" : ""}` })} stopPropagation><span>{ICON_GLYPHS[icon]}</span><small>{ICON_LABELS[icon]}</small></TacticalButton>;
          });
        })}
        {swarmIds.flatMap((swarmId) => session.state.swarms[swarmId]?.broodLordIds.map((broodLordId) => ({ broodLordId, swarmId })) ?? []).map(({ broodLordId, swarmId }) => {
          const option = uniquePayloadOption(decision, "cardId", broodLordId) ?? uniquePayloadOption(decision, "swarmId", swarmId);
          return <TacticalButton key={broodLordId} type="button" className={`genestealer-icon brood-lord ${option ? "legal-target" : ""}`} onTap={option ? () => onChooseOption(option.id) : undefined} onHold={() => onInspect({ eyebrow: "Brood Lord", title: "Brood Lord", body: "A Brood Lord counts as multiple Genestealers when attacking and follows its current movement icons.", meta: `Formation position ${positionIndex + 1}` })} stopPropagation><span>♛</span><small>Lord</small></TacticalButton>;
        })}
      </div>
      {!terrainIds.length && !swarmIds.length && <span className="clear-lane">Clear</span>}
    </div>
  );
}

function DiePanel({ value, skull, purpose, rerolls }: { value: number; skull: boolean; purpose: string; rerolls: number }) {
  return <section className="die-panel"><div className="die-face"><strong>{value}</strong>{skull && <span>☠</span>}</div><div><span>Combat die</span><strong>{formatPhase(purpose)}</strong><small>{rerolls ? `${rerolls} reroll${rerolls === 1 ? "" : "s"}` : "Initial result"}</small></div></section>;
}

function InspectionDrawer({ inspection, onClose }: { inspection: Inspection; onClose: () => void }) {
  return (
    <div className="inspection-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="inspection-drawer" role="dialog" aria-modal="true" aria-labelledby="inspection-title">
        <div className="inspection-handle" aria-hidden="true" />
        <button type="button" className="inspection-close" onClick={onClose} aria-label="Close card details">×</button>
        <span className="inspection-eyebrow">{inspection.eyebrow}</span><h2 id="inspection-title">{inspection.title}</h2>{inspection.meta && <p className="inspection-meta">{inspection.meta}</p>}<p className="inspection-body">{inspection.body}</p>
        <div className="inspection-note">Viewing this card does not make a game choice.</div>
      </aside>
    </div>
  );
}
