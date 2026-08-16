/* eslint-disable @next/next/no-img-element -- The UI lab compares pixel-art placement directly. */
import "./ui-lab.css";

type TerrainConcept = "plate" | "underlay" | "object";

const concepts: Array<{ mode: TerrainConcept; title: string; note: string }> = [
  { mode: "plate", title: "Environmental plate", note: "Terrain defines the whole threat space; swarm stays on top." },
  { mode: "underlay", title: "Swarm underlay", note: "Terrain is a compact marker beneath the enemies." },
  { mode: "object", title: "Object silhouette", note: "Terrain becomes a recognizable industrial object behind the swarm." },
];

function TerrainConceptCard({ mode, note, title }: (typeof concepts)[number]) {
  return <section className={`terrain-concept terrain-concept-${mode}`} aria-label={title}>
    <header><span>{title}</span><small>{note}</small></header>
    <div className="terrain-concept-row">
      <div className="terrain-concept-flank terrain-concept-left"><span className="terrain-concept-label"><i />Door</span><span className="terrain-concept-support">●● <b>2</b></span><span className="terrain-concept-object" aria-hidden="true"><i /><i /><i /></span><img src="../../prototype-art/alien-attack.gif" alt="" /></div>
      <div className="terrain-concept-marine"><img src="../../prototype-art/marine-idle.gif" alt="" /><span>Brother Deino</span><small>R2 · ●1</small></div>
      <div className="terrain-concept-flank terrain-concept-right"><span className="terrain-concept-label"><i />Promethium tank</span><span className="terrain-concept-support">● <b>1</b></span><span className="terrain-concept-object" aria-hidden="true"><i /><i /><i /></span><img src="../../prototype-art/alien-attack.gif" alt="" /></div>
    </div>
  </section>;
}

export default function TerrainConcepts() {
  return <main className="terrain-concepts-shell">
    <header className="terrain-concepts-heading"><span>Space Hulk · UI lab</span><h1>Terrain language</h1><p>Three alternatives for terrain, support tokens, and a less card-like Marine presence.</p><a href="../">Back to UI lab</a></header>
    <section className="terrain-concepts-board" aria-label="Terrain representation comparisons">{concepts.map((concept) => <TerrainConceptCard key={concept.mode} {...concept} />)}</section>
  </main>;
}
