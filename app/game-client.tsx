"use client";

import { useMemo, useState } from "react";
import dataJson from "@/src/data/generated/base-game.json";
import {
  canUndo,
  getUndoStatus,
  newEngineSession,
  submitSessionDecision,
  undo,
  type EngineSession,
  type PendingDecision,
} from "@/src/engine";
import type { GenestealerIcon, Side, TeamColor } from "@/src/data/types";

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

export default function GameClient() {
  const [selectedTeams, setSelectedTeams] = useState<TeamColor[]>([]);
  const [session, setSession] = useState<EngineSession | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [stagedOptionId, setStagedOptionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      setSession(newEngineSession({ gameId, seed, teamColors: selectedTeams as [TeamColor, TeamColor, TeamColor] }, "PLAYER"));
      setInspection(null);
      setStagedOptionId(null);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The mission could not be started.");
    }
  };

  const confirmDecision = () => {
    const decision = session?.state.pendingDecision;
    if (!session || !decision || !stagedOptionId) return;
    try {
      setSession(submitSessionDecision(session, decision.id, stagedOptionId));
      setStagedOptionId(null);
      setInspection(null);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That choice could not be resolved.");
    }
  };

  const undoOne = () => {
    if (!session || !canUndo(session)) return;
    setSession(undo(session));
    setStagedOptionId(null);
    setInspection(null);
  };

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

  return <MissionBoard session={session} inspection={inspection} stagedOptionId={stagedOptionId} error={error} onInspect={setInspection} onStage={setStagedOptionId} onConfirm={confirmDecision} onUndo={undoOne} onDismissInspection={() => setInspection(null)} onNewMission={() => setSession(null)} />;
}

type MissionBoardProps = {
  session: EngineSession;
  inspection: Inspection | null;
  stagedOptionId: string | null;
  error: string | null;
  onInspect: (inspection: Inspection) => void;
  onStage: (optionId: string) => void;
  onConfirm: () => void;
  onUndo: () => void;
  onDismissInspection: () => void;
  onNewMission: () => void;
};

function MissionBoard({ session, inspection, stagedOptionId, error, onInspect, onStage, onConfirm, onUndo, onDismissInspection, onNewMission }: MissionBoardProps) {
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
  const stagedOption = decision?.legalOptions.find((option) => option.id === stagedOptionId) ?? null;

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
        <button type="button" className="inspectable location-button" onClick={() => onInspect(locationInspection)}>
          <span><small>{currentLocation ? `Location · ${currentLocation.tier}` : "Setup location"}</small><strong>{currentLocation?.name ?? setupLocationName(componentDefinitionId(session, state.currentLocationInstanceId))}</strong></span>
          <span className="tap-hint">Tap for rules&nbsp; ⓘ</span>
        </button>
        <div className="blip-readout"><span>Port <strong>{leftBlips}</strong></span><i aria-hidden="true"><b style={{ width: `${Math.min(leftBlips * 8, 100)}%` }} /></i><span>Starboard <strong>{rightBlips}</strong></span><i aria-hidden="true"><b style={{ width: `${Math.min(rightBlips * 8, 100)}%` }} /></i></div>
      </section>

      {lastEvent && lastEventId && (
        <button type="button" className="event-ribbon inspectable" onClick={() => onInspect(sourceInspection(session, lastEventId)!)}>
          <span className="event-kicker">{state.phase === "EVENT" ? "Event resolving" : "Last event"}</span><strong>{lastEvent.name}</strong><span>{lastEvent.movementIcon ? `${ICON_GLYPHS[lastEvent.movementIcon]} ${ICON_LABELS[lastEvent.movementIcon]}` : "View card text"} &nbsp;›</span>
        </button>
      )}

      <section className="board-and-command">
        <div className="formation-board">
          <div className="column-labels"><span>Port threat</span><span>Formation</span><span>Starboard threat</span></div>
          {state.formation.map((slot, positionIndex) => (
            <FormationRow key={slot.marineInstanceId} session={session} positionIndex={positionIndex} targetIds={targetIds} onInspect={onInspect} />
          ))}
        </div>

        <aside className="decision-column">
          {state.activeDie && <DiePanel value={state.activeDie.modifiedValue} skull={state.activeDie.skull} purpose={state.activeDie.purpose} rerolls={state.activeDie.rerolls.length} />}
          <section className="decision-panel" aria-live="polite">
            <div className="decision-heading"><span>Pending decision</span><strong>{decision ? formatPhase(decision.type) : state.status}</strong></div>
            {decision ? (
              <>
                <p className="decision-prompt">{decision.promptKey.replaceAll(".", " · ").replaceAll("_", " ")}</p>
                <div className="option-list">
                  {decision.legalOptions.map((option) => (
                    <button key={option.id} type="button" className="decision-option" aria-pressed={stagedOptionId === option.id} onClick={() => onStage(option.id)}>
                      <span><strong>{option.label}</strong>{option.canonicalEffectPreview && <small>{option.canonicalEffectPreview}</small>}</span><i aria-hidden="true">{stagedOptionId === option.id ? "✓" : "›"}</i>
                    </button>
                  ))}
                </div>
                <button type="button" className="confirm-command" disabled={!stagedOption} onClick={onConfirm}>Confirm choice</button>
              </>
            ) : (
              <div className="mission-result"><strong>{state.status === "VICTORY" ? "Mission accomplished" : state.status === "DEFEAT" ? "Squad eliminated" : "Resolving…"}</strong><button type="button" onClick={onNewMission}>Start new mission</button></div>
            )}
            {error && <p className="error-message" role="alert">{error}</p>}
          </section>

          <section className="action-reference">
            <div className="panel-label">Combat team cards · tap to inspect</div>
            <div className="action-reference-grid">
              {state.activeTeams.flatMap((team) => state.teams[team].actionInstanceIds).map((actionId) => {
                const action = data.definitions.actions.find((item) => item.id === componentDefinitionId(session, actionId));
                if (!action) return null;
                return <button key={actionId} type="button" className={`reference-card team-${action.team.toLowerCase()}`} onClick={() => onInspect(sourceInspection(session, actionId)!)}><span>{action.team}</span><strong>{action.name}</strong><small>Initiative {action.initiative}</small></button>;
              })}
            </div>
          </section>
        </aside>
      </section>

      <section className="history-bar">
        <div className="history-feed">{recentTransitions.map((transition) => <span key={transition.seq}><b>{String(transition.seq).padStart(3, "0")}</b>{formatTransition(transition.type)}</span>)}</div>
        <button type="button" className="undo-command" disabled={!undoStatus.allowed} onClick={onUndo}><span>↶</span><strong>Undo</strong><small>{undoStatus.allowed ? `${undoStatus.availableSteps} step${undoStatus.availableSteps === 1 ? "" : "s"} available` : undoStatus.unavailableReason === "RANDOMNESS_BARRIER" ? "Locked by random result" : undoStatus.unavailableReason === "HIDDEN_INFORMATION_BARRIER" ? "Locked by card reveal" : "No reversible step"}</small></button>
      </section>

      {inspection && <InspectionDrawer inspection={inspection} onClose={onDismissInspection} />}
    </main>
  );
}

function FormationRow({ session, positionIndex, targetIds, onInspect }: { session: EngineSession; positionIndex: number; targetIds: Set<string>; onInspect: (inspection: Inspection) => void }) {
  const { state } = session;
  const slot = state.formation[positionIndex];
  const marine = state.marines[slot.marineInstanceId];
  const marineDefinition = data.definitions.marines.find((item) => item.id === componentDefinitionId(session, slot.marineInstanceId))!;
  const legalMarine = targetIds.has(slot.marineInstanceId);
  return (
    <div className={`formation-row ${targetIds.has(`position:${positionIndex}`) ? "legal-row" : ""}`}>
      <Flank session={session} positionIndex={positionIndex} side="LEFT" targetIds={targetIds} onInspect={onInspect} />
      <button type="button" className={`marine-card inspectable team-${marineDefinition.team.toLowerCase()} ${legalMarine ? "legal-target" : ""}`} onClick={() => onInspect(sourceInspection(session, slot.marineInstanceId)!)}>
        <span className="marine-facing" aria-label={`Facing ${marine.facing}`}>{marine.facing === "LEFT" ? "◀" : "▶"}</span>
        <span className="marine-team">{marineDefinition.team} team</span>
        <strong>{marineDefinition.name}</strong>
        <span className="marine-stats"><b>◎ Range {marineDefinition.attackRange}</b><i>{marine.support ? `${"●".repeat(marine.support)} support` : "No support"}</i></span>
      </button>
      <Flank session={session} positionIndex={positionIndex} side="RIGHT" targetIds={targetIds} onInspect={onInspect} />
    </div>
  );
}

function Flank({ session, positionIndex, side, targetIds, onInspect }: { session: EngineSession; positionIndex: number; side: Side; targetIds: Set<string>; onInspect: (inspection: Inspection) => void }) {
  const slot = session.state.formation[positionIndex];
  const terrainIds = slot.terrainInstanceIds[side];
  const swarmIds = slot.swarmIds[side];
  return (
    <div className="flank-cell">
      <div className="terrain-stack">
        {terrainIds.map((terrainId) => {
          const terrain = data.definitions.terrain.find((item) => item.id === componentDefinitionId(session, terrainId));
          if (!terrain) return null;
          return <button key={terrainId} type="button" className={`terrain-chip inspectable ${targetIds.has(terrainId) ? "legal-target" : ""}`} onClick={() => onInspect(sourceInspection(session, terrainId)!)}><span>{terrain.name}</span><i>ⓘ</i>{session.state.terrain[terrainId]?.support > 0 && <b>{"●".repeat(session.state.terrain[terrainId].support)}</b>}</button>;
        })}
      </div>
      <div className="swarm-stack">
        {swarmIds.flatMap((swarmId) => {
          const swarm = session.state.swarms[swarmId];
          if (!swarm) return [];
          return swarm.cardIds.map((cardId) => {
            const icon = session.state.genestealers[cardId].icon;
            const legal = targetIds.has(swarmId) || targetIds.has(cardId);
            return <button key={cardId} type="button" className={`genestealer-icon ${legal ? "legal-target" : ""}`} aria-label={`${ICON_LABELS[icon]} Genestealer. Tap to inspect.`} onClick={() => onInspect({ eyebrow: `Genestealer · ${side.toLowerCase()} swarm`, title: ICON_LABELS[icon], body: `A ${ICON_LABELS[icon].toLowerCase()} Genestealer in a swarm of ${swarm.cardIds.length + swarm.broodLordIds.length}.`, meta: `Formation position ${positionIndex + 1}${session.state.genestealers[cardId].movedOrFlankedThisEvent ? " · moved this event" : ""}` })}><span>{ICON_GLYPHS[icon]}</span><small>{ICON_LABELS[icon]}</small></button>;
          });
        })}
        {swarmIds.flatMap((swarmId) => session.state.swarms[swarmId]?.broodLordIds ?? []).map((broodLordId) => <button key={broodLordId} type="button" className={`genestealer-icon brood-lord ${targetIds.has(broodLordId) ? "legal-target" : ""}`} onClick={() => onInspect({ eyebrow: "Brood Lord", title: "Brood Lord", body: "A Brood Lord counts as multiple Genestealers when attacking and follows its current movement icons.", meta: `Formation position ${positionIndex + 1}` })}><span>♛</span><small>Lord</small></button>)}
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
