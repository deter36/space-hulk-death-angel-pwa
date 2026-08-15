"use client";

import type { LabInspection } from "./formation-board";

type MissionHudProps = {
  activeStep: string;
  onInspect: (details: LabInspection) => void;
};

const LOCATION_TEXT = "Upon entering: Spawn 2 Genestealers on the Corridor Terrain card.";
const EVENT_TEXT = "Choose a Space Marine. Spawn 2 Genestealers behind him.";

export default function MissionHud({ activeStep, onInspect }: MissionHudProps) {
  return (
    <section className="lab-hud" aria-label="Mission status">
      <div className="lab-hud-command">
        <div className="lab-hud-brand"><span>Space Hulk:</span><strong>Death Angel</strong></div>
        <div className="lab-hud-cycle"><span>Round</span><strong>03</strong></div>
        <div className="lab-hud-phase"><span>Current phase</span><strong>{activeStep}</strong></div>
        <div className="lab-hud-tools"><button type="button" aria-label="Undo information" onClick={() => onInspect({ eyebrow: "Command control", title: "Undo", body: "Undo remains available until a random result occurs. This HUD button will connect to the existing engine undo command during integration." })}>↶</button><button type="button" aria-label="Open mission options" onClick={() => onInspect({ eyebrow: "Command control", title: "Mission options", body: "Board scale, diagnostics, save controls, and mission controls will open from this compact utility button." })}>⚙</button></div>
      </div>

      <div className="lab-location-frame">
        <div className="lab-blip-counter lab-blip-left"><span>Blips</span><strong>07</strong><em>Left</em></div>
        <button type="button" className="lab-location-card" onClick={() => onInspect({ eyebrow: "Location · Level 1A", title: "Main Corridor", subtitle: "Upon Entering", body: LOCATION_TEXT })}>
          <span>Current location <b>Level 1A</b></span>
          <h2>Main Corridor</h2>
          <strong>Upon Entering</strong>
          <p>{LOCATION_TEXT}</p>
          <i className="lab-hud-rivet lab-rivet-one" /><i className="lab-hud-rivet lab-rivet-two" />
        </button>
        <div className="lab-blip-counter lab-blip-right"><span>Blips</span><strong>08</strong><em>Right</em></div>
      </div>

      <button type="button" className="lab-event-card" onClick={() => onInspect({ eyebrow: "Current event · Instinct", title: "Out of Thin Air", subtitle: "Minor Orange · Minor Red · Flank · Claw", body: EVENT_TEXT })}>
        <div className="lab-event-heading"><span>Current event <i>Instinct</i></span><h3>Out of Thin Air</h3></div>
        <p>{EVENT_TEXT}</p>
        <div className="lab-event-data" aria-label="Event spawn and movement data"><span><i className="lab-spawn-dot is-orange" />Minor</span><span><i className="lab-spawn-dot is-red" />Minor</span><span className="lab-move-readout"><b>↭</b> Flank</span><span className="lab-icon-readout">ϟ Claw</span></div>
      </button>
    </section>
  );
}
