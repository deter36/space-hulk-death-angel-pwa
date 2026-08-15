"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import FormationBoard, { cellKey, type LabInspection } from "./formation-board";
import { INTERACTION_SCENARIO } from "./formation-fixtures";
import type { LabFormationRow } from "./formation-types";
import MissionHud from "./mission-hud";
import "./ui-lab.css";

const SOURCE_ROW = 2;
const DESTINATION_ROW = 1;
const SIDE = "RIGHT" as const;
const SOURCE_KEY = cellKey(SOURCE_ROW, SIDE);

function initialRows(): LabFormationRow[] {
  return INTERACTION_SCENARIO.rows.map((row, index) => {
    if (index === DESTINATION_ROW) return { ...row, right: { ...row.right, swarm: { icons: ["TAIL", "CLAW"] } } };
    if (index === SOURCE_ROW) return { ...row, right: { ...row.right, swarm: { icons: ["HEAD", "TONGUE", "CLAW"] } } };
    return row;
  });
}

function moveAndMerge(rows: LabFormationRow[]): LabFormationRow[] {
  const source = rows[SOURCE_ROW].right.swarm;
  const destination = rows[DESTINATION_ROW].right.swarm;
  if (!source || !destination) return rows;
  return rows.map((row, index) => {
    if (index === SOURCE_ROW) return { ...row, right: { ...row.right, swarm: undefined } };
    if (index === DESTINATION_ROW) return { ...row, right: { ...row.right, swarm: { broodLords: (source.broodLords ?? 0) + (destination.broodLords ?? 0) || undefined, icons: [...source.icons, ...destination.icons] } } };
    return row;
  });
}

export default function SwarmMovementDemo({ assetBase }: { assetBase: string }) {
  const [busy, setBusy] = useState(false);
  const [inspection, setInspection] = useState<LabInspection | null>(null);
  const [moving, setMoving] = useState(false);
  const [rows, setRows] = useState(initialRows);
  const [status, setStatus] = useState("Ready for Genestealer movement");
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const schedule = (callback: () => void, delay: number) => { timers.current.push(setTimeout(callback, delay)); };
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => clearTimers, []);

  const moveSwarm = () => {
    if (busy || !rows[SOURCE_ROW].right.swarm) return;
    clearTimers(); setBusy(true); setMoving(true); setStatus("Genestealer swarm advances");
    schedule(() => { setRows(moveAndMerge); setMoving(false); setBusy(false); setStatus("Swarms merged · 5 Genestealers at Brother Noctis"); }, 1150);
  };
  const reset = () => { clearTimers(); setBusy(false); setMoving(false); setRows(initialRows()); setStatus("Ready for Genestealer movement"); };
  const merged = !rows[SOURCE_ROW].right.swarm;
  const style = { "--lab-scale": "1", "--lab-viewport": "620px" } as CSSProperties;

  return <main className="lab-game-view has-combat-rim" style={style}>
    <MissionHud activeStep="Genestealer movement" onInspect={setInspection} />
    <div className="lab-choice-banner lab-choice-red"><span>Genestealer movement</span><strong>{status}</strong><em>Move whole swarm → merge</em></div>
    <FormationBoard rows={rows} movingSwarmCell={moving ? SOURCE_KEY : null} marineSpriteUrl={`${assetBase}/marine-idle.gif`} alienSpriteUrl={`${assetBase}/alien-attack.gif`} alienIdleStripUrl="../../game-art/genestealer/idle.png" broodlordSpriteUrl="../../game-art/broodlord/idle.png" swarmStates={{ [SOURCE_KEY]: moving ? "targeted" : "selectable", [cellKey(DESTINATION_ROW, SIDE)]: "targeted" }} onInspect={setInspection} />
    <div className="lab-animation-dock"><div><span>{merged ? "Merged swarm: 5 · only the foremost 3 sprites render" : "3 Genestealers move into a 2-creature swarm"}</span><strong>{status}</strong></div><button type="button" onClick={moveSwarm} disabled={busy || merged}>Move swarm</button><button type="button" onClick={reset}>Reset</button></div>
    {inspection && <div className="lab-inspection-backdrop"><button type="button" className="lab-inspection-dismiss" aria-label="Close details and return to board" onClick={() => setInspection(null)} /><section className="lab-inspection-drawer" role="dialog" aria-modal="true" aria-labelledby="movement-inspection-title"><span>{inspection.eyebrow}</span><h2 id="movement-inspection-title">{inspection.title}</h2>{inspection.subtitle && <strong>{inspection.subtitle}</strong>}<p>{inspection.body}</p><button type="button" onClick={() => setInspection(null)}>Return to board</button></section></div>}
  </main>;
}
