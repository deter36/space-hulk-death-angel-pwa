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

function initialRows(): LabFormationRow[] {
  return INTERACTION_SCENARIO.rows.map((row, index) => index === TARGET_ROW ? { ...row, right: { ...row.right, swarm: { icons: ["HEAD", "TAIL", "CLAW"] } } } : { ...row });
}

export default function SwarmAnimationDemo({ assetBase }: { assetBase: string }) {
  const [animation, setAnimation] = useState<"attack" | "death" | null>(null);
  const [accent, setAccent] = useState(true);
  const [inspection, setInspection] = useState<LabInspection | null>(null);
  const [rows, setRows] = useState(initialRows);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const playAttack = () => {
    if (animation) return;
    setAnimation("attack");
    timer.current = setTimeout(() => setAnimation(null), 1000);
  };
  const playDeath = () => {
    if (animation || !rows[TARGET_ROW].right.swarm?.icons.length) return;
    setAnimation("death");
    timer.current = setTimeout(() => {
      setRows((current) => current.map((row, index) => index === TARGET_ROW ? { ...row, right: { ...row.right, swarm: row.right.swarm ? { ...row.right.swarm, icons: row.right.swarm.icons.slice(1) } : undefined } } : row));
      setAnimation(null);
    }, 1400);
  };
  const reset = () => { if (timer.current) clearTimeout(timer.current); setAnimation(null); setRows(initialRows()); };
  const count = rows[TARGET_ROW].right.swarm?.icons.length ?? 0;
  const style = { "--lab-scale": "1", "--lab-viewport": "620px" } as CSSProperties;

  return <main className={`lab-game-view ${accent ? "has-combat-rim" : ""}`} style={style}>
    <MissionHud activeStep="Combat animation" onInspect={setInspection} />
    <div className="lab-choice-banner lab-choice-red"><span>Swarm animation preview</span><strong>Lead creature animates</strong><em>Death removes it; the next layer advances</em></div>
    <FormationBoard rows={rows} marineSpriteUrl={`${assetBase}/marine-idle.gif`} alienSpriteUrl={`${assetBase}/alien-attack.gif`} alienIdleStripUrl="../../game-art/genestealer/idle.png" broodlordSpriteUrl="../../game-art/broodlord/idle.png" alienAttackStripUrl="../../game-art/genestealer/attack.png" alienDeathStripUrl="../../game-art/genestealer/death.png" swarmAnimationStates={animation ? { [TARGET_KEY]: animation } : {}} swarmStates={{ [TARGET_KEY]: "targeted" }} onInspect={setInspection} />
    <div className="lab-animation-dock"><div><span>Target swarm · right side · row 1</span><strong>{count} Genestealer{count === 1 ? "" : "s"} remaining</strong></div><button type="button" className={accent ? "is-active" : ""} onClick={() => setAccent((current) => !current)}>Rim {accent ? "on" : "off"}</button><button type="button" onClick={playAttack} disabled={Boolean(animation) || count === 0}>Attack</button><button type="button" onClick={playDeath} disabled={Boolean(animation) || count === 0}>Kill lead</button><button type="button" onClick={reset}>Reset</button></div>
    {inspection && <div className="lab-inspection-backdrop"><button type="button" className="lab-inspection-dismiss" aria-label="Close details and return to board" onClick={() => setInspection(null)} /><section className="lab-inspection-drawer" role="dialog" aria-modal="true" aria-labelledby="swarm-inspection-title"><span>{inspection.eyebrow}</span><h2 id="swarm-inspection-title">{inspection.title}</h2>{inspection.subtitle && <strong>{inspection.subtitle}</strong>}<p>{inspection.body}</p><button type="button" onClick={() => setInspection(null)}>Return to board</button></section></div>}
  </main>;
}
