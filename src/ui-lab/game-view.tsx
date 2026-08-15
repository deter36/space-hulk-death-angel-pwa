"use client";

import { useState, type CSSProperties } from "react";
import ActionSelection from "./action-selection";
import FormationBoard, { type LabInspection } from "./formation-board";
import { INTERACTION_SCENARIO } from "./formation-fixtures";
import MissionHud from "./mission-hud";
import "./ui-lab.css";

export default function GameView({ assetBase }: { assetBase: string }) {
  const [inspection, setInspection] = useState<LabInspection | null>(null);
  const [selectedMarine, setSelectedMarine] = useState<string | null>(null);
  const scenario = INTERACTION_SCENARIO;
  const style = { "--lab-scale": "1", "--lab-viewport": "620px" } as CSSProperties;

  return (
    <main className="lab-game-view" style={style}>
      <MissionHud activeStep="Action selection" onInspect={setInspection} />
      <div className="lab-choice-banner"><span>Blue team · Move + Activate</span><strong>Select a Marine</strong><em>Tap to choose · hold for details</em></div>
      <FormationBoard rows={scenario.rows} marineSpriteUrl={`${assetBase}/marine-idle.gif`} alienSpriteUrl={`${assetBase}/alien-attack.gif`} alienIdleStripUrl="../../game-art/genestealer/idle.png" broodlordSpriteUrl="../../game-art/broodlord/idle.png" selectedMarine={selectedMarine} onSelectMarine={setSelectedMarine} onInspect={setInspection} />
      <div className="lab-state-legend"><span><i className="selectable" />Selectable</span><span><i className="selected" />Selected</span><span><i className="targeted" />Targeted</span><span><i className="unavailable" />Unavailable</span></div>
      <ActionSelection />
      {inspection && <div className="lab-inspection-backdrop"><button type="button" className="lab-inspection-dismiss" aria-label="Close details and return to board" onClick={() => setInspection(null)} /><section className="lab-inspection-drawer" role="dialog" aria-modal="true" aria-labelledby="game-inspection-title"><span>{inspection.eyebrow}</span><h2 id="game-inspection-title">{inspection.title}</h2>{inspection.subtitle && <strong>{inspection.subtitle}</strong>}<p>{inspection.body}</p><button type="button" onClick={() => setInspection(null)}>Return to board</button></section></div>}
    </main>
  );
}
