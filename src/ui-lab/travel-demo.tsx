"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import FormationBoard from "./formation-board";
import { INTERACTION_SCENARIO } from "./formation-fixtures";
import type { LabFormationRow } from "./formation-types";
import "./ui-lab.css";

type TravelStage = "ready" | "retreat" | "crossfade" | "arrive" | "complete";

const terrainSpriteUrls = {
  Door: "../../game-art/terrain/door-v1.png",
  "Control Panel": "../../game-art/terrain/control-panel-v1.png",
  "Promethium Tank": "../../game-art/terrain/promethium-tank-v1.png",
  "Ventilation Duct": "../../game-art/terrain/ventilation-duct-v1.png",
  "Spore Chimney": "../../game-art/terrain/spore-chimney-v1.png",
};

function arrivalRows(): LabFormationRow[] {
  return INTERACTION_SCENARIO.rows.map((row, index) => {
    if (index === 0) return { ...row, right: { terrain: { name: "Ventilation Duct", color: "GREEN" }, swarm: { icons: ["HEAD", "TAIL"] } } };
    if (index === 1) return { ...row, left: { terrain: { name: "Door", color: "YELLOW" }, swarm: { icons: ["CLAW"] } } };
    if (index === 3) return { ...row, left: { swarm: { icons: ["TAIL", "TONGUE"] } } };
    if (index === 4) return { ...row, right: { terrain: { name: "Promethium Tank", color: "ORANGE" }, swarm: { icons: ["HEAD", "CLAW", "TAIL"] } } };
    return { ...row };
  });
}

const status: Record<TravelStage, string> = {
  ready: "Travel is ready",
  retreat: "Genestealers withdraw",
  crossfade: "Passing into the next location",
  arrive: "Threats close in",
  complete: "Location 2 entered",
};

export default function TravelDemo({ assetBase }: { assetBase: string }) {
  const [stage, setStage] = useState<TravelStage>("ready");
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const schedule = (next: TravelStage, delay: number) => timers.current.push(setTimeout(() => setStage(next), delay));
  useEffect(() => clearTimers, []);

  const travel = () => {
    if (stage !== "ready" && stage !== "complete") return;
    clearTimers();
    setStage("retreat");
    schedule("crossfade", 2550);
    schedule("arrive", 3000);
    schedule("complete", 4450);
  };
  const reset = () => { clearTimers(); setStage("ready"); };
  const arrived = stage === "arrive" || stage === "complete";
  const style = { "--lab-scale": "1", "--lab-viewport": "620px" } as CSSProperties;

  return <main className="lab-game-view travel-demo" style={style}>
    <header className="travel-demo-header"><span>Travel animation study</span><strong>{arrived ? "Location 2 · Catacombs" : "Location 1 · Launch Bay"}</strong><em>{status[stage]}</em></header>
    <section className={`travel-board-window is-${stage}`} aria-label="Travel animation preview">
      <div className="travel-board-stage">
        <FormationBoard
          rows={arrived ? arrivalRows() : INTERACTION_SCENARIO.rows}
          locationProgress={arrived ? "2" : "1"}
          marineSpriteUrl={`${assetBase}/marine-idle.gif`}
          alienSpriteUrl={`${assetBase}/alien-attack.gif`}
          alienIdleStripUrl="../../game-art/genestealer/idle.png"
          broodlordSpriteUrl="../../game-art/broodlord/idle.png"
          terrainSpriteUrls={terrainSpriteUrls}
        />
      </div>
      <div className="travel-blackout" aria-hidden="true" />
    </section>
    <div className="travel-demo-dock"><div><span>Travel choreography</span><strong>{status[stage]}</strong></div><button type="button" onClick={travel} disabled={stage !== "ready" && stage !== "complete"}>{stage === "complete" ? "Replay" : "Travel"}</button><button type="button" onClick={reset} disabled={stage === "ready"}>Reset</button></div>
  </main>;
}
