/* eslint-disable @next/next/no-img-element -- The lab intentionally renders pixel art directly. */
import type { CSSProperties } from "react";
import "./ui-lab.css";

type TerrainName = "Door" | "Control Panel" | "Promethium Tank" | "Spore Chimney" | "Ventilation Duct";
type TerrainMock = { name: TerrainName; color: "yellow" | "orange" | "red"; support?: number; selectable?: boolean };

function TerrainGlyph({ terrain, depth }: { terrain: TerrainMock; depth: number }) {
  return <div className={`terrain-glyph terrain-${terrain.name.toLowerCase().replaceAll(" ", "-")} terrain-${terrain.color} ${terrain.selectable ? "is-selectable" : ""}`} style={{ "--terrain-depth": depth } as CSSProperties} aria-label={`${terrain.name}${terrain.support ? `, ${terrain.support} support tokens` : ""}`}>
    <span className="terrain-glyph-silhouette" aria-hidden="true"><i /><i /><i /></span><strong>{terrain.name}</strong><em><b />{terrain.support ? "●".repeat(terrain.support) : ""}</em>
  </div>;
}

function TerrainStack({ terrain }: { terrain: TerrainMock[] }) {
  return <div className="terrain-stack-mock">{terrain.map((item, index) => <TerrainGlyph key={`${item.name}.${index}`} terrain={item} depth={terrain.length - index - 1} />)}{terrain.length > 1 && <span className="terrain-stack-count">×{terrain.length}</span>}</div>;
}

const rows: Array<{ left: TerrainMock[]; right: TerrainMock[]; marine: string }> = [
  { left: [{ name: "Door", color: "yellow", support: 2 }], right: [{ name: "Promethium Tank", color: "orange" }], marine: "Brother Deino" },
  { left: [{ name: "Ventilation Duct", color: "red" }, { name: "Control Panel", color: "yellow", selectable: true }], right: [{ name: "Spore Chimney", color: "red", support: 1 }, { name: "Door", color: "yellow" }], marine: "Sergeant Lorenzo" },
  { left: [{ name: "Door", color: "yellow" }, { name: "Promethium Tank", color: "orange" }, { name: "Control Panel", color: "yellow" }], right: [], marine: "Brother Claudio" },
];

export default function TerrainConcepts() {
  return <main className="terrain-concepts-shell terrain-stack-lab">
    <header className="terrain-concepts-heading"><span>Space Hulk · UI lab</span><h1>Terrain stack treatment</h1><p>Small industrial silhouettes sit in the outside lane behind a swarm. Each object retains its spawn color and support tokens; stacks remain visible rather than collapsing into a single box.</p><a href="../">Back to UI lab</a></header>
    <section className="terrain-mock-board" aria-label="Terrain stack game board mockup">
      <header><span>Terrain behind swarm</span><small>Blue rim = currently selectable Terrain</small></header>
      <div className="terrain-mock-formation">
        {rows.map((row, index) => <div className="terrain-mock-row" key={row.marine}>
          <div className="terrain-mock-flank terrain-mock-left"><TerrainStack terrain={row.left} /><img src="../../prototype-art/alien-attack.gif" alt="" /><span className="terrain-mock-swarm">{index === 1 ? "3" : "2"}</span></div>
          <div className="terrain-mock-marine"><img src="../../prototype-art/marine-idle.gif" alt="" /><strong>{row.marine}</strong><small>Range {index === 2 ? 0 : 2}</small></div>
          <div className="terrain-mock-flank terrain-mock-right"><TerrainStack terrain={row.right} />{row.right.length > 0 && <><img src="../../prototype-art/alien-attack.gif" alt="" /><span className="terrain-mock-swarm">2</span></>}</div>
        </div>)}
      </div>
      <footer><span><i className="terrain-swatch terrain-yellow" />Door / panel</span><span><i className="terrain-swatch terrain-orange" />Tank</span><span><i className="terrain-swatch terrain-red" />Duct / chimney</span><span>● Support token</span></footer>
    </section>
  </main>;
}
