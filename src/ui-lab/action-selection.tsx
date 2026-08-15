"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { TeamColor } from "@/src/data/types";

type ActionType = "ATTACK" | "MOVE_ACTIVATE" | "SUPPORT";

type LabActionCard = {
  id: string;
  initiative: number;
  name: string;
  rules: string;
  team: TeamColor;
  type: ActionType;
  unavailable?: boolean;
};

const TYPE_LABELS: Record<ActionType, string> = {
  ATTACK: "Attack",
  MOVE_ACTIVATE: "Move + Activate",
  SUPPORT: "Support",
};

const MINI_TYPE_LABELS: Record<ActionType, string> = { ...TYPE_LABELS, MOVE_ACTIVATE: "Move" };

const TEAM_ORDER: TeamColor[] = ["GREEN", "BLUE", "RED"];

const ACTIONS: LabActionCard[] = [
  { id: "green.block", team: "GREEN", name: "Block", initiative: 1, type: "SUPPORT", rules: "Each time Sergeant Gideon rolls a skull while defending, the attack misses.", unavailable: true },
  { id: "green.run-and-gun", team: "GREEN", name: "Run and Gun", initiative: 12, type: "MOVE_ACTIVATE", rules: "After resolving this card's action, each of your Space Marines may spend 1 Support Token to make 1 attack." },
  { id: "green.dead-aim", team: "GREEN", name: "Dead Aim", initiative: 16, type: "ATTACK", rules: "Each time 1 of your attacking Space Marines rolls a 4, slay up to 3 Genestealers from the defending swarm." },
  { id: "blue.counter-attack", team: "BLUE", name: "Counter Attack", initiative: 3, type: "SUPPORT", rules: "Each time Sergeant Lorenzo rolls a skull while defending, the attack misses and slay 1 of the attacking Genestealers. If the swarm still contains a Genestealer, it attacks again." },
  { id: "blue.intimidation", team: "BLUE", name: "Intimidation", initiative: 11, type: "MOVE_ACTIVATE", rules: "After resolving this card's action, roll a die. Shuffle that many engaged Genestealer cards of your choice into the smallest blip pile.", unavailable: true },
  { id: "blue.lead-by-example", team: "BLUE", name: "Lead By Example", initiative: 13, type: "ATTACK", rules: "When 1 of your Space Marines slays a Genestealer, place 1 Support Token on any Space Marine. Limit once per round." },
  { id: "red.overwatch", team: "RED", name: "Overwatch", initiative: 4, type: "SUPPORT", rules: "At the end of the Event Phase, each of your Space Marines may spend 1 Support Token to make 1 attack." },
  { id: "red.onward-brothers", team: "RED", name: "Onward Brothers!", initiative: 7, type: "MOVE_ACTIVATE", rules: "Each time 1 of your Space Marines activates a Door, place 1 additional Support Token on the Terrain card." },
  { id: "red.full-auto", team: "RED", name: "Full Auto", initiative: 17, type: "ATTACK", rules: "Brother Leon may attack up to 3 times instead of just once.", unavailable: true },
];

function teamCards(team: TeamColor) {
  return ACTIONS.filter((card) => card.team === team);
}

function MiniCard({ card, index }: { card: LabActionCard; index: number }) {
  return (
    <span className={`lab-mini-action-card lab-team-${card.team.toLowerCase()} ${card.unavailable ? "is-unavailable" : ""}`} style={{ "--card-index": index } as CSSProperties}>
      <b>{MINI_TYPE_LABELS[card.type]}</b>
    </span>
  );
}

function ChosenCard({ card }: { card: LabActionCard }) {
  return (
    <span className={`lab-chosen-action lab-team-${card.team.toLowerCase()}`}>
      <small>{TYPE_LABELS[card.type]} · {card.initiative}</small>
      <strong>{card.name}</strong>
    </span>
  );
}

type StepNotice = { cardText?: string; detail: string; kicker: string; title: string };

function TransitionNotice({ notice, onContinue }: { notice: StepNotice; onContinue: () => void }) {
  return (
    <div className="lab-step-backdrop">
      <section className="lab-step-notice" role="dialog" aria-modal="true" aria-label={notice.title}>
        <span>{notice.kicker}</span><h2>{notice.title}</h2><p>{notice.detail}</p>{notice.cardText && <blockquote>{notice.cardText}</blockquote>}
        <button type="button" onClick={onContinue}>Continue</button>
      </section>
    </div>
  );
}

function DieRollDemo({ onProceed }: { onProceed: () => void }) {
  const timer = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const [rolling, setRolling] = useState(true);

  const settle = useCallback(() => {
    if (timer.current !== null) globalThis.clearTimeout(timer.current);
    timer.current = null;
    setRolling(false);
  }, []);

  useEffect(() => {
    timer.current = globalThis.setTimeout(settle, 2300);
    return () => {
      if (timer.current !== null) globalThis.clearTimeout(timer.current);
    };
  }, [settle]);

  return (
    <div className="lab-die-backdrop">
      <section className={`lab-die-result ${rolling ? "is-rolling" : "is-settled"}`} role="dialog" aria-modal="true" aria-label="Defense roll demonstration">
        <span>Defense roll</span><h2>Sergeant Lorenzo</h2>
        <div className="lab-die-stage" aria-live="polite"><div className="lab-die-cube" data-rolling={rolling || undefined} aria-label={rolling ? "Combat die rolling" : "Combat die result 2, skull"}>
          <span className="face-front"><strong>2</strong><i>💀︎</i></span><span className="face-back"><strong>5</strong></span><span className="face-right"><strong>1</strong><i>💀︎</i></span><span className="face-left"><strong>4</strong></span><span className="face-top"><strong>3</strong><i>💀︎</i></span><span className="face-bottom"><strong>0</strong></span>
        </div></div>
        <p>{rolling ? "Rolling…" : "2 · Skull result"}</p>
        <button type="button" onClick={rolling ? settle : onProceed}>{rolling ? "Skip roll" : "Acknowledge result"}</button>
      </section>
    </div>
  );
}

function InformationNotice({ card, onContinue }: { card: LabActionCard; onContinue: () => void }) {
  return (
    <div className="lab-info-backdrop">
      <section className={`lab-info-notice lab-team-${card.team.toLowerCase()}`} role="dialog" aria-modal="true" aria-label="Card effect resolved">
        <span>{card.team} squad effect</span><h2>{card.name}</h2><strong>2 · Skull</strong><p>Counter Attack triggers. Slay 1 attacking Genestealer; if the swarm remains, it attacks again.</p>
        <button type="button" onClick={onContinue}>Continue</button>
      </section>
    </div>
  );
}

export default function ActionSelection() {
  const [expandedTeam, setExpandedTeam] = useState<TeamColor | null>(null);
  const [pendingCardId, setPendingCardId] = useState<string | null>(null);
  const [resolutionIndex, setResolutionIndex] = useState<number | null>(null);
  const [stepNotice, setStepNotice] = useState<StepNotice | null>(null);
  const [showDieRoll, setShowDieRoll] = useState(false);
  const [showInformation, setShowInformation] = useState(false);
  const [selections, setSelections] = useState<Partial<Record<TeamColor, string>>>({});
  const selectedCards = useMemo(() => Object.values(selections).map((id) => ACTIONS.find((card) => card.id === id)).filter((card): card is LabActionCard => Boolean(card)), [selections]);
  const initiativeCards = useMemo(() => [...selectedCards].sort((left, right) => left.initiative - right.initiative), [selectedCards]);
  const allSelected = selectedCards.length === TEAM_ORDER.length;
  const activeCard = resolutionIndex !== null && resolutionIndex < initiativeCards.length ? initiativeCards[resolutionIndex] : null;
  const expandedCards = expandedTeam ? teamCards(expandedTeam) : [];

  function openTeam(team: TeamColor) {
    if (allSelected) return;
    setExpandedTeam(team);
    setPendingCardId(selections[team] ?? null);
  }

  function confirmSelection() {
    const card = ACTIONS.find((item) => item.id === pendingCardId);
    if (!card || card.unavailable || card.team !== expandedTeam) return;
    setSelections((current) => ({ ...current, [card.team]: card.id }));
    setExpandedTeam(null);
    setPendingCardId(null);
  }

  function reset() {
    setSelections({});
    setExpandedTeam(null);
    setPendingCardId(null);
    setResolutionIndex(null);
    setStepNotice(null);
    setShowDieRoll(false);
    setShowInformation(false);
  }

  function beginResolution() {
    setResolutionIndex(0);
    setStepNotice({ kicker: "Action phase", title: "Resolve selected actions", detail: "Cards resolve from lowest initiative to highest initiative." });
  }

  function completeActiveCard() {
    if (resolutionIndex === null) return;
    const nextIndex = resolutionIndex + 1;
    if (nextIndex < initiativeCards.length) {
      const next = initiativeCards[nextIndex];
      setResolutionIndex(nextIndex);
      setStepNotice({ kicker: `Next action · Initiative ${next.initiative}`, title: next.name, detail: `${next.team} squad · ${TYPE_LABELS[next.type]}`, cardText: next.rules });
      return;
    }
    setResolutionIndex(initiativeCards.length);
    setStepNotice({ kicker: "Action phase complete", title: "Genestealer Attack Phase", detail: "Resolve each engaged swarm from the top of the formation downward." });
  }

  return (
    <section className={`lab-action-dock ${expandedTeam ? "is-expanded" : ""}`} aria-label="Action selection prototype">
      {expandedTeam && (
        <div className={`lab-expanded-hand lab-team-${expandedTeam.toLowerCase()}`}>
          <header><span>{expandedTeam} squad</span><strong>Choose an action</strong><button type="button" onClick={() => setExpandedTeam(null)} aria-label="Close action hand">×</button></header>
          <div className="lab-full-action-grid">
            {expandedCards.map((card) => (
              <button type="button" className={`lab-full-action-card lab-team-${card.team.toLowerCase()} ${pendingCardId === card.id ? "is-pending" : ""} ${card.unavailable ? "is-unavailable" : ""}`} disabled={card.unavailable} onClick={() => setPendingCardId(card.id)} key={card.id}>
                <small>{TYPE_LABELS[card.type]}</small>
                <strong>{card.name}</strong>
                <b>Initiative {card.initiative}</b>
                <p>{card.rules}</p>
                {card.unavailable && <i aria-hidden="true">×</i>}
              </button>
            ))}
          </div>
          <button type="button" className="lab-confirm-action" disabled={!pendingCardId || ACTIONS.find((card) => card.id === pendingCardId)?.unavailable} onClick={confirmSelection}>{pendingCardId ? "Select action" : "Choose a card"}</button>
        </div>
      )}

      <div className="lab-action-dock-heading"><span>{resolutionIndex !== null ? (activeCard ? "Resolving actions" : "Action phase complete") : allSelected ? "Initiative order" : "Select squad actions"}</span><b>{resolutionIndex !== null ? `${Math.min(resolutionIndex + 1, initiativeCards.length)}/${initiativeCards.length}` : `${selectedCards.length}/${TEAM_ORDER.length}`}</b>{allSelected && resolutionIndex === null && <button type="button" onClick={beginResolution}>Start resolution</button>}{activeCard && <><button type="button" onClick={() => setShowDieRoll(true)}>Roll demo</button><button type="button" onClick={completeActiveCard}>Complete card</button></>}{allSelected && !activeCard && resolutionIndex !== null && <button type="button" onClick={reset}>Reset demo</button>}</div>
      <div className={`lab-action-hands ${allSelected ? "is-initiative-order" : ""}`}>
        {(allSelected ? initiativeCards.map((card) => card.team) : TEAM_ORDER).map((team, orderIndex) => {
          const selected = ACTIONS.find((card) => card.id === selections[team]);
          const resolutionState = resolutionIndex === null ? "" : orderIndex < resolutionIndex ? "is-completed" : orderIndex === resolutionIndex && activeCard ? "is-active" : "is-upcoming";
          return (
            <button type="button" className={`lab-action-team-slot lab-team-${team.toLowerCase()} ${selected ? "has-selection" : ""} ${resolutionState}`} onClick={() => openTeam(team)} disabled={allSelected} key={team}>
              <span className="lab-action-team-name">{team}</span>
              {selected ? <ChosenCard card={selected} /> : <span className="lab-mini-hand">{teamCards(team).map((card, index) => <MiniCard card={card} index={index} key={card.id} />)}</span>}
            </button>
          );
        })}
      </div>
      {stepNotice && <TransitionNotice notice={stepNotice} onContinue={() => setStepNotice(null)} />}
      {showDieRoll && <DieRollDemo onProceed={() => { setShowDieRoll(false); setShowInformation(true); }} />}
      {showInformation && activeCard && <InformationNotice card={activeCard} onContinue={() => setShowInformation(false)} />}
    </section>
  );
}
