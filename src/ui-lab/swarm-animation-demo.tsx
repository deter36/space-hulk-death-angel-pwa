"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import FormationBoard, { cellKey, type LabInspection } from "./formation-board";
import { INTERACTION_SCENARIO } from "./formation-fixtures";
import type { LabFormationRow } from "./formation-types";
import MissionHud from "./mission-hud";
import "./ui-lab.css";

const TARGET_ROW = 0;
const TARGET_SIDE = "RIGHT" as const;
const TARGET_KEY = cellKey(TARGET_ROW, TARGET_SIDE);
const TARGET_MARINE = "Sergeant Gideon";

type Outcome = "hit" | "miss";
type MarineAnimation = "death" | "dodge";

function initialRows(): LabFormationRow[] {
  return INTERACTION_SCENARIO.rows.map((row, index) => index === TARGET_ROW ? { ...row, right: { ...row.right, swarm: { icons: ["HEAD", "TAIL", "CLAW"] } } } : { ...row });
}

function condenseTopCasualty(rows: LabFormationRow[]): LabFormationRow[] {
  if (rows.length < 2) return [];
  const casualty = rows[0];
  const survivor = rows[1];
  const mergeFlank = (destination: LabFormationRow["left"], source: LabFormationRow["left"]): LabFormationRow["left"] => ({
    terrain: destination.terrain ?? source.terrain,
    swarm: destination.swarm && source.swarm ? {
      broodLords: (destination.swarm.broodLords ?? 0) + (source.swarm.broodLords ?? 0),
      icons: [...destination.swarm.icons, ...source.swarm.icons],
    } : destination.swarm ?? source.swarm,
  });
  return [{ ...survivor, left: mergeFlank(survivor.left, casualty.left), right: mergeFlank(survivor.right, casualty.right) }, ...rows.slice(2)];
}

function CombatDie({ outcome, rolling }: { outcome: Outcome; rolling: boolean }) {
  const result = outcome === "hit" ? 2 : 5;
  return <div className="lab-die-backdrop"><section className={`lab-die-result ${rolling ? "is-rolling" : "is-settled"}`} role="dialog" aria-modal="true" aria-label={`Defense roll ${result}, ${outcome}`}>
    <span>Genestealer attack · Defense roll</span><h2>{TARGET_MARINE}</h2>
    <div className="lab-die-stage"><div className="lab-die-cube" data-rolling={rolling || undefined} aria-label={rolling ? "Combat die rolling" : `Combat die result ${result}`}>
      <span className="face-front"><strong>{result}</strong>{result === 2 && <i>💀︎</i>}</span><span className="face-back"><strong>0</strong></span><span className="face-right"><strong>1</strong><i>💀︎</i></span><span className="face-left"><strong>4</strong></span><span className="face-top"><strong>3</strong><i>💀︎</i></span><span className="face-bottom"><strong>{outcome === "hit" ? 5 : 2}</strong></span>
    </div></div>
    <p>{rolling ? "Rolling…" : outcome === "hit" ? `${result} vs 3 attackers · Marine hit` : `${result} vs 3 attackers · Attack misses`}</p>
  </section></div>;
}

export default function SwarmAnimationDemo({ assetBase }: { assetBase: string }) {
  const [busy, setBusy] = useState(false);
  const [collapsingMarine, setCollapsingMarine] = useState<string | null>(null);
  const [die, setDie] = useState<{ outcome: Outcome; rolling: boolean } | null>(null);
  const [inspection, setInspection] = useState<LabInspection | null>(null);
  const [marineAnimation, setMarineAnimation] = useState<MarineAnimation | null>(null);
  const [marineDead, setMarineDead] = useState(false);
  const [rows, setRows] = useState(initialRows);
  const [status, setStatus] = useState("Ready to resolve attack");
  const [swarmAnimation, setSwarmAnimation] = useState<"attack" | "death" | null>(null);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const schedule = (callback: () => void, delay: number) => { timers.current.push(setTimeout(callback, delay)); };
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => clearTimers, []);

  const playDefense = (outcome: Outcome) => {
    if (busy || marineDead || rows.length < initialRows().length) return;
    clearTimers(); setBusy(true); setSwarmAnimation("attack"); setStatus("Lead Genestealer attacks");
    schedule(() => { setSwarmAnimation(null); setDie({ outcome, rolling: true }); setStatus("Rolling Marine defense"); }, 1000);
    schedule(() => { setDie({ outcome, rolling: false }); setStatus(outcome === "hit" ? "Hit confirmed" : "Attack misses"); }, 3300);
    schedule(() => { setDie(null); setMarineAnimation(outcome === "hit" ? "death" : "dodge"); setStatus(outcome === "hit" ? "Marine slain" : "Marine dodges"); }, 4200);
    schedule(() => {
      if (outcome === "hit") {
        setMarineDead(true);
        setStatus("Casualty confirmed");
      } else {
        setBusy(false);
        setStatus("Miss resolved · Marine returns to idle");
      }
      setMarineAnimation(null);
    }, 5600);
    if (outcome === "hit") {
      schedule(() => { setCollapsingMarine(TARGET_MARINE); setStatus("Closing formation"); }, 6400);
      schedule(() => {
        setRows((current) => condenseTopCasualty(current));
        setCollapsingMarine(null); setMarineDead(false); setBusy(false); setStatus("Formation condensed · Threats move with the fallen slot");
      }, 7000);
    }
  };
  const playGenestealerDeath = () => {
    if (busy || !rows[TARGET_ROW].right.swarm?.icons.length) return;
    setBusy(true); setSwarmAnimation("death"); setStatus("Lead Genestealer slain");
    schedule(() => {
      setRows((current) => current.map((row, index) => index === TARGET_ROW ? { ...row, right: { ...row.right, swarm: row.right.swarm ? { ...row.right.swarm, icons: row.right.swarm.icons.slice(1) } : undefined } } : row));
      setSwarmAnimation(null); setBusy(false); setStatus("Next creature advances to lead");
    }, 1400);
  };
  const reset = () => { clearTimers(); setBusy(false); setCollapsingMarine(null); setDie(null); setMarineAnimation(null); setMarineDead(false); setRows(initialRows()); setStatus("Ready to resolve attack"); setSwarmAnimation(null); };
  const count = rows[TARGET_ROW]?.right.swarm?.icons.length ?? 0;
  const style = { "--lab-scale": "1", "--lab-viewport": "620px" } as CSSProperties;

  return <main className="lab-game-view has-combat-rim" style={style}>
    <MissionHud activeStep="Combat sequence" onInspect={setInspection} />
    <div className="lab-choice-banner lab-choice-red"><span>Genestealer attack timing</span><strong>{status}</strong><em>Attack → die → casualty → formation</em></div>
    <FormationBoard rows={rows} collapsingMarine={collapsingMarine} marineSpriteUrl={`${assetBase}/marine-idle.gif`} marineDeathStripUrl="../../game-art/marine/death.png" marineDodgeStripUrl="../../game-art/marine/dodge.png" marineAnimationStates={marineDead ? { [TARGET_MARINE]: "dead" } : marineAnimation ? { [TARGET_MARINE]: marineAnimation } : {}} alienSpriteUrl={`${assetBase}/alien-attack.gif`} alienIdleStripUrl="../../game-art/genestealer/idle.png" broodlordSpriteUrl="../../game-art/broodlord/idle.png" alienAttackStripUrl="../../game-art/genestealer/attack.png" alienDeathStripUrl="../../game-art/genestealer/death.png" swarmAnimationStates={swarmAnimation ? { [TARGET_KEY]: swarmAnimation } : {}} swarmStates={{ [TARGET_KEY]: "targeted" }} onInspect={setInspection} />
    <div className="lab-animation-dock"><div><span>{rows.length < initialRows().length ? "5 Marines remain · swarm transferred to Brother Noctis" : `3 attackers vs ${TARGET_MARINE}`}</span><strong>{status}</strong></div><button type="button" onClick={() => playDefense("hit")} disabled={busy || rows.length < initialRows().length || count === 0}>Hit</button><button type="button" onClick={() => playDefense("miss")} disabled={busy || rows.length < initialRows().length || count === 0}>Miss</button><button type="button" onClick={playGenestealerDeath} disabled={busy || count === 0}>Kill G</button><button type="button" onClick={reset}>Reset</button></div>
    {die && <CombatDie outcome={die.outcome} rolling={die.rolling} />}
    {inspection && <div className="lab-inspection-backdrop"><button type="button" className="lab-inspection-dismiss" aria-label="Close details and return to board" onClick={() => setInspection(null)} /><section className="lab-inspection-drawer" role="dialog" aria-modal="true" aria-labelledby="swarm-inspection-title"><span>{inspection.eyebrow}</span><h2 id="swarm-inspection-title">{inspection.title}</h2>{inspection.subtitle && <strong>{inspection.subtitle}</strong>}<p>{inspection.body}</p><button type="button" onClick={() => setInspection(null)}>Return to board</button></section></div>}
  </main>;
}
