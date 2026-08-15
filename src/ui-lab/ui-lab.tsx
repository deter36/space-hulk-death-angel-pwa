"use client";

import { useState, type CSSProperties } from "react";
import ActionSelection from "./action-selection";
import BoardInteraction, { type InteractionMode } from "./board-interaction";
import FormationBoard, { type LabInspection } from "./formation-board";
import { INTERACTION_SCENARIO, LAB_SCENARIOS } from "./formation-fixtures";
import MissionHud from "./mission-hud";
import "./ui-lab.css";

type UiLabProps = {
  assetBase: string;
};

export default function UiLab({ assetBase }: UiLabProps) {
  const [scenarioId, setScenarioId] = useState(LAB_SCENARIOS[0].id);
  const [demo, setDemo] = useState<"action" | InteractionMode>("action");
  const [inspection, setInspection] = useState<LabInspection | null>(null);
  const [scale, setScale] = useState(1);
  const [selectedMarine, setSelectedMarine] = useState<string | null>("Sergeant Lorenzo");
  const [viewport, setViewport] = useState<"360" | "412" | "full">("full");
  const scenario = LAB_SCENARIOS.find((item) => item.id === scenarioId) ?? LAB_SCENARIOS[0];
  const displayedScenario = demo === "action" ? scenario : INTERACTION_SCENARIO;
  const activeStep = demo === "action" ? "Action selection" : demo === "move" ? "Move + Activate" : demo === "attack" ? "Attack" : "Strategize";
  const style = {
    "--lab-scale": String(scale),
    "--lab-viewport": viewport === "full" ? "620px" : `${viewport}px`,
  } as CSSProperties;

  return (
    <main className="ui-lab-shell" style={style}>
      <header className="ui-lab-header">
        <div><span>Death Angel · UI laboratory</span><h1>Formation Information</h1></div>
        <a href="../">Return to game</a>
      </header>

      <section className="ui-lab-controls" aria-label="Preview controls">
        <label><span>Interaction demo</span><select value={demo} onChange={(event) => setDemo(event.target.value as "action" | InteractionMode)}><option value="action">Action selection + resolution</option><option value="move">Move + Activate input</option><option value="attack">Attack targeting</option><option value="strategize">Strategize swarm movement</option></select></label>
        {demo === "action" && <label><span>Scenario</span><select value={scenarioId} onChange={(event) => setScenarioId(event.target.value)}>{LAB_SCENARIOS.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}
        <label className="lab-scale-control"><span>Board scale</span><input type="range" min="0.8" max="1.2" step="0.05" value={scale} onChange={(event) => setScale(Number(event.target.value))} /><output>{Math.round(scale * 100)}%</output></label>
        <fieldset><legend>Preview width</legend>{(["360", "412", "full"] as const).map((width) => <button type="button" className={viewport === width ? "is-active" : ""} onClick={() => setViewport(width)} key={width}>{width === "full" ? "Full" : `${width}px`}</button>)}</fieldset>
      </section>

      <p className="ui-lab-description">{displayedScenario.description}</p>
      <div className="ui-lab-viewport">
        <MissionHud activeStep={activeStep} onInspect={setInspection} />
        {demo === "action" ? <><div className="lab-choice-banner"><span>Blue team · Move + Activate</span><strong>Select a Marine</strong><em>Tap to choose · hold for details</em></div><FormationBoard rows={scenario.rows} marineSpriteUrl={`${assetBase}/marine-idle.gif`} alienSpriteUrl={`${assetBase}/alien-attack.gif`} broodlordSpriteUrl="../game-art/broodlord/idle.png" selectedMarine={selectedMarine} onSelectMarine={setSelectedMarine} onInspect={setInspection} /></> : <BoardInteraction key={demo} mode={demo} rows={INTERACTION_SCENARIO.rows} marineSpriteUrl={`${assetBase}/marine-idle.gif`} alienSpriteUrl={`${assetBase}/alien-attack.gif`} broodlordSpriteUrl="../game-art/broodlord/idle.png" onInspect={setInspection} />}
        <div className="lab-state-legend"><span><i className="selectable" />Selectable</span><span><i className="selected" />Selected</span><span><i className="targeted" />Targeted</span><span><i className="unavailable" />Unavailable</span></div>
      </div>

      <aside className="ui-lab-notes"><strong>This checkpoint tests</strong><span>Marine identity · range · support · special abilities · swarm contents · choice context · selection states</span></aside>
      {demo === "action" && <ActionSelection />}
      {inspection && <div className="lab-inspection-backdrop"><button type="button" className="lab-inspection-dismiss" aria-label="Close details and return to board" onClick={() => setInspection(null)} /><section className="lab-inspection-drawer" role="dialog" aria-modal="true" aria-labelledby="lab-inspection-title"><span>{inspection.eyebrow}</span><h2 id="lab-inspection-title">{inspection.title}</h2>{inspection.subtitle && <strong>{inspection.subtitle}</strong>}<p>{inspection.body}</p><button type="button" onClick={() => setInspection(null)}>Return to board</button></section></div>}
    </main>
  );
}
