/* eslint-disable @next/next/no-img-element -- The lab intentionally renders animated sprite canvases directly. */
import type { GenestealerIcon, Side } from "@/src/data/types";
import { Fragment, useRef, type CSSProperties, type MouseEvent } from "react";
import type { LabFlank, LabFormationRow, LabMarine, LabSwarm, LabTerrain } from "./formation-types";

const ICON_GLYPHS: Record<GenestealerIcon, string> = { HEAD: "◉", TAIL: "⌁", CLAW: "ϟ", TONGUE: "⌇" };

export type LabTargetState = "neutral" | "selectable" | "selected" | "targeted" | "unavailable" | "destination";
export type LabInspection = { eyebrow: string; title: string; subtitle?: string; body: string };
export type LabOverlayChoice = { label: string; row: number; side: Side; state?: LabTargetState };
export type LabMarineMoveChoice = { label: string; row: number };

type FormationBoardProps = {
  alienSpriteUrl: string;
  alienAttackStripUrl?: string;
  alienDeathStripUrl?: string;
  alienIdleStripUrl?: string;
  broodlordSpriteUrl?: string;
  broodlordAttackStripUrl?: string;
  broodlordDeathStripUrl?: string;
  marineSpriteUrl: string;
  marineDeathStripUrl?: string;
  marineDodgeStripUrl?: string;
  marineFireStripUrls?: Partial<Record<"straight" | "up" | "down", string>>;
  marineJamStripUrls?: Partial<Record<"straight" | "up" | "down", string>>;
  marineAnimationStates?: Record<string, "dead" | "death" | "dodge" | "fire-straight" | "fire-up" | "fire-down" | "gunJam-straight" | "gunJam-up" | "gunJam-down">;
  collapsingMarine?: string | null;
  movingSwarmCell?: string | null;
  movingSwarmCells?: Record<string, "up" | "down" | "flank">;
  marineStates?: Record<string, LabTargetState>;
  marineMoveChoices?: LabMarineMoveChoice[];
  moveSlots?: number[];
  onInspect?: (details: LabInspection) => void;
  onMoveSlot?: (slot: number) => void;
  onMarineMoveChoice?: (choice: LabMarineMoveChoice) => void;
  onOverlayChoice?: (choice: LabOverlayChoice) => void;
  onSelectMarine?: (name: string) => void;
  onSelectSwarm?: (row: number, side: Side) => void;
  onSelectTerrain?: (row: number, side: Side) => void;
  overlayChoices?: LabOverlayChoice[];
  rows: LabFormationRow[];
  selectedMarine?: string | null;
  swarmStates?: Record<string, LabTargetState>;
  swarmAnimationStates?: Record<string, "attack" | "death">;
  terrainStates?: Record<string, LabTargetState>;
};

export const cellKey = (row: number, side: Side) => `${row}.${side}`;

export const MARINE_DETAILS: Record<string, { ability?: string; abilityText?: string; range: number }> = {
  "Brother Claudio": { ability: "Heroic Charge", abilityText: "Instead of attacking normally, slay up to 3 Genestealers within range 1, ignoring facing. Then roll: on a 0, Brother Claudio is slain.", range: 0 },
  "Sergeant Lorenzo": { ability: "Counter Attack", abilityText: "When defending, a skull result makes the attack miss and slays 1 attacking Genestealer. If any remain, they attack again.", range: 2 },
  "Brother Deino": { range: 2 },
  "Brother Leon": { ability: "Full Auto", abilityText: "Brother Leon may make up to 3 attacks during Full Auto.", range: 3 },
  "Brother Valencio": { range: 2 },
  "Brother Noctis": { range: 2 },
  "Brother Zael": { ability: "Flamer Attack", abilityText: "Ignore skulls. Slay a number of Genestealers in the target swarm equal to the number rolled.", range: 1 },
  "Sergeant Gideon": { ability: "Block", abilityText: "When defending, a skull result makes the Genestealer attack miss.", range: 0 },
};

const TERRAIN_RULES: Record<string, string> = {
  "Control Panel": "Activate: resolve the current Location card's Control Panel ability.",
  Corridor: "This Terrain has no Activate ability.",
  "Dark Corner": "This Terrain has no Activate ability.",
  Door: "Activate: place 1 Support Token here. When traveling, slay 1 Genestealer at this position for each Support Token on the Door.",
  "Promethium Tank": "Activate: discard this Terrain and slay every Genestealer at this position. Roll the die; on a 0, the activating Space Marine is slain.",
  "Spore Chimney": "Activate: roll the die. On a skull, discard this Terrain.",
  "Ventilation Duct": "This Terrain has no Activate ability.",
};

function usePress(onTap: () => void, onHold: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  return {
    onClick: (event: MouseEvent) => { if (held.current) { held.current = false; event.preventDefault(); return; } onTap(); },
    onContextMenu: (event: MouseEvent) => event.preventDefault(),
    onPointerCancel: clear,
    onPointerDown: () => { held.current = false; clear(); timer.current = setTimeout(() => { held.current = true; onHold(); }, 520); },
    onPointerLeave: clear,
    onPointerUp: clear,
  };
}

function inspectSwarm(swarm: LabSwarm): LabInspection {
  const broodLords = swarm.broodLords ?? 0;
  const icons = swarm.icons.length ? swarm.icons.join(" · ") : "None";
  return { eyebrow: "Genestealer swarm", title: `${swarm.icons.length + broodLords} enemies`, subtitle: broodLords ? `${broodLords} Brood Lord${broodLords === 1 ? "" : "s"}` : undefined, body: `Icons: ${icons}.${broodLords ? " Brood Lords are represented by the crown until their dedicated sprite is added." : ""}` };
}

function inspectTerrain(terrain: LabTerrain): LabInspection {
  return { eyebrow: `${terrain.color} spawn Terrain`, title: terrain.name, body: TERRAIN_RULES[terrain.name] ?? "No additional Terrain text is loaded for this preview." };
}

function SwarmReadout({ swarm }: { swarm: LabSwarm }) {
  const count = swarm.icons.length + (swarm.broodLords ?? 0);
  return <div className="lab-swarm-readout" aria-label={`${count} Genestealers`}><b>{count}</b><span>{swarm.icons.map((icon, index) => <i key={`${icon}.${index}`} title={icon}>{ICON_GLYPHS[icon]}</i>)}{Array.from({ length: swarm.broodLords ?? 0 }, (_, index) => <i key={`lord.${index}`} className="lab-brood-icon" title="Brood Lord">♛</i>)}</span></div>;
}

function Flank({ alienAttackStripUrl, alienDeathStripUrl, alienIdleStripUrl, alienSpriteUrl, broodlordAttackStripUrl, broodlordDeathStripUrl, broodlordSpriteUrl, flank, moving, movementDirection, onInspect, onSelectSwarm, onSelectTerrain, overlay, side, swarmAnimation, swarmState = "neutral", terrainState = "neutral" }: { alienAttackStripUrl?: string; alienDeathStripUrl?: string; alienIdleStripUrl?: string; alienSpriteUrl: string; broodlordAttackStripUrl?: string; broodlordDeathStripUrl?: string; broodlordSpriteUrl?: string; flank: LabFlank; moving?: boolean; movementDirection?: "up" | "down" | "flank"; onInspect?: (details: LabInspection) => void; onSelectSwarm: () => void; onSelectTerrain: () => void; overlay?: LabOverlayChoice; side: Side; swarmAnimation?: "attack" | "death"; swarmState?: LabTargetState; terrainState?: LabTargetState }) {
  const visibleMembers = flank.swarm ? [...Array.from({ length: flank.swarm.broodLords ?? 0 }, () => "broodlord" as const), ...flank.swarm.icons.map(() => "genestealer" as const)].slice(0, 3) : [];
  const terrainPress = usePress(onSelectTerrain, () => flank.terrain && onInspect?.(inspectTerrain(flank.terrain)));
  const swarmPress = usePress(onSelectSwarm, () => flank.swarm && onInspect?.(inspectSwarm(flank.swarm)));
  return (
    <div className={`lab-flank lab-flank-${side.toLowerCase()} ${flank.swarm ? "is-engaged" : ""} ${flank.terrain ? "has-terrain" : ""} ${moving ? `is-swarm-moving is-swarm-moving-${movementDirection ?? "up"}` : ""}`}>
      {flank.terrain && <button type="button" className={`lab-terrain lab-spawn-${flank.terrain.color.toLowerCase()} is-${terrainState}`} aria-label={`${flank.terrain.name} Terrain`} aria-disabled={terrainState === "unavailable"} {...terrainPress}><span><i />{flank.terrain.name}</span></button>}
      {flank.swarm && <button type="button" className={`lab-swarm-target is-${swarmState}`} aria-label={`${flank.swarm.icons.length + (flank.swarm.broodLords ?? 0)} Genestealer swarm`} aria-disabled={swarmState === "unavailable"} {...swarmPress}><span className="lab-swarm-sprites">{visibleMembers.map((member, index) => {
        const animationUrl = swarmAnimation === "attack" ? alienAttackStripUrl : swarmAnimation === "death" ? alienDeathStripUrl : undefined;
        if (index === 0 && member === "broodlord" && swarmAnimation) {
          const broodlordAnimationUrl = swarmAnimation === "attack" ? broodlordAttackStripUrl : broodlordDeathStripUrl;
          if (broodlordAnimationUrl) return <span className={`lab-alien-sprite lab-broodlord-strip is-${swarmAnimation}`} style={{ "--swarm-layer": index, backgroundImage: `url(${broodlordAnimationUrl})` } as CSSProperties} aria-hidden="true" key={`${member}.${index}`} />;
        }
        if (index === 0 && member === "genestealer" && swarmAnimation && animationUrl) return <span className={`lab-alien-sprite lab-genestealer-strip is-${swarmAnimation}`} style={{ "--swarm-layer": index, backgroundImage: `url(${animationUrl})` } as CSSProperties} aria-hidden="true" key={`${member}.${index}`} />;
        if (member === "broodlord" && broodlordSpriteUrl) return <span className="lab-alien-sprite lab-broodlord-sprite" style={{ "--swarm-layer": index, backgroundImage: `url(${broodlordSpriteUrl})` } as CSSProperties} aria-hidden="true" key={`${member}.${index}`} />;
        if (alienIdleStripUrl) return <span className="lab-alien-sprite lab-genestealer-strip is-idle" style={{ "--swarm-layer": index, backgroundImage: `url(${alienIdleStripUrl})` } as CSSProperties} aria-hidden="true" key={`${member}.${index}`} />;
        return <img className="lab-alien-sprite" style={{ "--swarm-layer": index } as CSSProperties} src={alienSpriteUrl} alt="" key={`${member}.${index}`} />;
      })}</span><SwarmReadout swarm={flank.swarm} /></button>}
      {overlay && <button type="button" className={`lab-cell-choice is-${overlay.state ?? "destination"}`} onClick={() => overlay && onSelectSwarm()} aria-label={overlay.label}><b>{overlay.side === "LEFT" ? "←" : "→"}</b><span>{overlay.label}</span></button>}
      {!flank.swarm && !flank.terrain && !overlay && <span className="lab-clear-mark">·</span>}
    </div>
  );
}

function Marine({ animation, deathStripUrl, dodgeStripUrl, fireStripUrls, jamStripUrls, marine, marineSpriteUrl, moveChoice, onInspect, onSelect, state }: { animation?: "dead" | "death" | "dodge" | "fire-straight" | "fire-up" | "fire-down" | "gunJam-straight" | "gunJam-up" | "gunJam-down"; deathStripUrl?: string; dodgeStripUrl?: string; fireStripUrls?: Partial<Record<"straight" | "up" | "down", string>>; jamStripUrls?: Partial<Record<"straight" | "up" | "down", string>>; marine: LabMarine; marineSpriteUrl: string; moveChoice?: LabMarineMoveChoice; onInspect?: (details: LabInspection) => void; onSelect: () => void; state: LabTargetState }) {
  const { facing, name, supportTokens = 0, team } = marine;
  const fallbackDetails = MARINE_DETAILS[name] ?? Object.entries(MARINE_DETAILS).find(([fullName]) => fullName.endsWith(` ${name}`))?.[1] ?? { range: 0 };
  const details = { ...fallbackDetails, range: marine.range ?? fallbackDetails.range, ability: marine.ability ?? fallbackDetails.ability, abilityText: marine.abilityText ?? fallbackDetails.abilityText };
  const trajectory = animation?.split("-")[1] as "straight" | "up" | "down" | undefined;
  const animationUrl = animation === "death" || animation === "dead" ? deathStripUrl : animation === "dodge" ? dodgeStripUrl : animation?.startsWith("fire-") ? fireStripUrls?.[trajectory!] : animation?.startsWith("gunJam-") ? jamStripUrls?.[trajectory!] : undefined;
  const press = usePress(onSelect, () => onInspect?.({ eyebrow: `${team} team Space Marine`, title: name, subtitle: `Range ${details.range} · ${supportTokens} support token${supportTokens === 1 ? "" : "s"}`, body: details.ability ? `${details.ability}: ${details.abilityText}` : "This Space Marine has no individual special ability." }));
  return (
    <button type="button" className={`lab-marine lab-team-${team.toLowerCase()} lab-face-${facing.toLowerCase()} is-${state}`} aria-label={`${name}, ${team} team, range ${details.range}, ${supportTokens} support tokens, facing ${facing.toLowerCase()}`} aria-pressed={state === "selected"} aria-disabled={state === "unavailable"} {...press}>
      {animation && animationUrl ? <span className={`lab-marine-sprite lab-marine-strip is-${animation}`} style={{ backgroundImage: `url(${animationUrl})` }} aria-hidden="true" /> : <img className="lab-marine-sprite" src={marineSpriteUrl} alt="" />}
      {details.ability && <span className="lab-ability-marker" title={details.ability}>★</span>}
      <span className="lab-marine-stats"><b title={`Range ${details.range}`}>R{details.range}</b>{supportTokens > 0 && <b title={`${supportTokens} support tokens`}><i />{supportTokens}</b>}</span>
      <strong className="lab-marine-name">{name}</strong>{state === "unavailable" && <span className="lab-unavailable-mark" aria-hidden="true">×</span>}
      {moveChoice && <span className="lab-marine-move-choice"><b>⇅</b><em>{moveChoice.label}</em></span>}
    </button>
  );
}

export default function FormationBoard({ alienAttackStripUrl, alienDeathStripUrl, alienIdleStripUrl, alienSpriteUrl, broodlordAttackStripUrl, broodlordDeathStripUrl, broodlordSpriteUrl, collapsingMarine, marineAnimationStates = {}, marineDeathStripUrl, marineDodgeStripUrl, marineFireStripUrls, marineJamStripUrls, marineSpriteUrl, marineMoveChoices = [], moveSlots = [], movingSwarmCell, movingSwarmCells = {}, marineStates = {}, onInspect, onMarineMoveChoice, onMoveSlot, onOverlayChoice, onSelectMarine, onSelectSwarm, onSelectTerrain, overlayChoices = [], rows, selectedMarine, swarmAnimationStates = {}, swarmStates = {}, terrainStates = {} }: FormationBoardProps) {
  const renderMoveSlot = (slot: number) => moveSlots.includes(slot) ? <button type="button" className="lab-move-slot" onClick={() => onMoveSlot?.(slot)}><span>Move here</span></button> : null;
  return (
    <section className="lab-board" aria-label="Formation geometry preview"><div className="lab-formation">
      {rows.map((row, index) => {
        const leftOverlay = overlayChoices.find((choice) => choice.row === index && choice.side === "LEFT");
        const rightOverlay = overlayChoices.find((choice) => choice.row === index && choice.side === "RIGHT");
        const marineMoveChoice = marineMoveChoices.find((choice) => choice.row === index);
        const marineState = marineStates[row.marine.name] ?? (selectedMarine === row.marine.name ? "selected" : row.marine.interaction ?? "neutral");
        return <Fragment key={`${row.marine.team}.${row.marine.name}`}>{renderMoveSlot(index)}<div className={`lab-combat-row ${collapsingMarine === row.marine.name ? "is-collapsing" : ""}`}><span className="lab-row-number">{String(index + 1).padStart(2, "0")}</span>
          <Flank alienSpriteUrl={alienSpriteUrl} alienAttackStripUrl={alienAttackStripUrl} alienDeathStripUrl={alienDeathStripUrl} alienIdleStripUrl={alienIdleStripUrl} broodlordSpriteUrl={broodlordSpriteUrl} broodlordAttackStripUrl={broodlordAttackStripUrl} broodlordDeathStripUrl={broodlordDeathStripUrl} flank={row.left} moving={movingSwarmCell === cellKey(index, "LEFT") || Boolean(movingSwarmCells[cellKey(index, "LEFT")])} movementDirection={movingSwarmCells[cellKey(index, "LEFT")]} side="LEFT" swarmAnimation={swarmAnimationStates[cellKey(index, "LEFT")]} swarmState={swarmStates[cellKey(index, "LEFT")]} terrainState={terrainStates[cellKey(index, "LEFT")]} overlay={leftOverlay} onInspect={onInspect} onSelectSwarm={() => leftOverlay ? onOverlayChoice?.(leftOverlay) : onSelectSwarm?.(index, "LEFT")} onSelectTerrain={() => onSelectTerrain?.(index, "LEFT")} />
          <Marine marine={row.marine} marineSpriteUrl={marineSpriteUrl} animation={marineAnimationStates[row.marine.name]} deathStripUrl={marineDeathStripUrl} dodgeStripUrl={marineDodgeStripUrl} fireStripUrls={marineFireStripUrls} jamStripUrls={marineJamStripUrls} moveChoice={marineMoveChoice} state={marineMoveChoice ? "destination" : marineState} onInspect={onInspect} onSelect={() => marineMoveChoice ? onMarineMoveChoice?.(marineMoveChoice) : onSelectMarine?.(row.marine.name)} />
          <Flank alienSpriteUrl={alienSpriteUrl} alienAttackStripUrl={alienAttackStripUrl} alienDeathStripUrl={alienDeathStripUrl} alienIdleStripUrl={alienIdleStripUrl} broodlordSpriteUrl={broodlordSpriteUrl} broodlordAttackStripUrl={broodlordAttackStripUrl} broodlordDeathStripUrl={broodlordDeathStripUrl} flank={row.right} moving={movingSwarmCell === cellKey(index, "RIGHT") || Boolean(movingSwarmCells[cellKey(index, "RIGHT")])} movementDirection={movingSwarmCells[cellKey(index, "RIGHT")]} side="RIGHT" swarmAnimation={swarmAnimationStates[cellKey(index, "RIGHT")]} swarmState={swarmStates[cellKey(index, "RIGHT")]} terrainState={terrainStates[cellKey(index, "RIGHT")]} overlay={rightOverlay} onInspect={onInspect} onSelectSwarm={() => rightOverlay ? onOverlayChoice?.(rightOverlay) : onSelectSwarm?.(index, "RIGHT")} onSelectTerrain={() => onSelectTerrain?.(index, "RIGHT")} />
        </div>{index === rows.length - 1 && renderMoveSlot(rows.length)}</Fragment>;
      })}
    </div></section>
  );
}
