"use client";

import { useMemo, useState } from "react";
import type { Side } from "@/src/data/types";
import FormationBoard, { MARINE_DETAILS, cellKey, type LabInspection, type LabMarineMoveChoice, type LabOverlayChoice, type LabTargetState } from "./formation-board";
import type { LabFormationRow } from "./formation-types";

export type InteractionMode = "move" | "attack" | "strategize";
type Cell = { row: number; side: Side };

type BoardInteractionProps = {
  alienSpriteUrl: string;
  broodlordSpriteUrl?: string;
  marineSpriteUrl: string;
  mode: InteractionMode;
  onInspect: (details: LabInspection) => void;
  rows: LabFormationRow[];
};

const MODE_INFO = {
  move: { color: "BLUE", title: "Move + Activate", first: "Select a Blue team Marine" },
  attack: { color: "RED", title: "Attack", first: "Select a Red team Marine" },
  strategize: { color: "PURPLE", title: "Strategize", first: "Select a Genestealer swarm" },
} as const;

export default function BoardInteraction({ alienSpriteUrl, broodlordSpriteUrl, marineSpriteUrl, mode, onInspect, rows: initialRows }: BoardInteractionProps) {
  const [rows, setRows] = useState(() => initialRows.map((row) => ({ ...row })));
  const [marine, setMarine] = useState<string | null>(null);
  const [moveOrigin, setMoveOrigin] = useState<number | null>(null);
  const [moveSlot, setMoveSlot] = useState<number | null>(null);
  const [facing, setFacing] = useState<Side | null>(null);
  const [source, setSource] = useState<Cell | null>(null);
  const [destination, setDestination] = useState<Cell | null>(null);
  const [target, setTarget] = useState<Cell | null>(null);
  const [terrain, setTerrain] = useState<Cell | null>(null);
  const [complete, setComplete] = useState(false);

  const reset = () => { setRows(initialRows.map((row) => ({ ...row }))); setMarine(null); setMoveOrigin(null); setMoveSlot(null); setFacing(null); setSource(null); setDestination(null); setTarget(null); setTerrain(null); setComplete(false); };

  const selectedIndex = rows.findIndex((row) => row.marine.name === marine);
  const selectedMarine = selectedIndex >= 0 ? rows[selectedIndex].marine : null;
  const currentRow = moveSlot === null ? selectedIndex : Math.min(Math.max(moveSlot, 0), rows.length - 1);

  const marineStates = useMemo(() => Object.fromEntries(rows.map((row) => {
    let state: LabTargetState = "neutral";
    if (row.marine.name === marine) state = "selected";
    else if (!marine && ((mode === "move" && row.marine.team === "BLUE") || (mode === "attack" && row.marine.team === "RED"))) state = "selectable";
    else if (marine && row.marine.name !== marine) state = "neutral";
    return [row.marine.name, state];
  })), [marine, mode, rows]);

  const legalAttackTargets = useMemo(() => {
    if (mode !== "attack" || !selectedMarine || selectedIndex < 0) return [] as Cell[];
    const range = MARINE_DETAILS[selectedMarine.name]?.range ?? 0;
    return rows.flatMap((row, rowIndex) => (["LEFT", "RIGHT"] as Side[]).flatMap((side) => {
      const flank = side === "LEFT" ? row.left : row.right;
      return flank.swarm && side === selectedMarine.facing && Math.abs(rowIndex - selectedIndex) <= range ? [{ row: rowIndex, side }] : [];
    }));
  }, [mode, rows, selectedIndex, selectedMarine]);

  const legalStrategizeDestinations = useMemo(() => {
    if (!source) return [] as LabOverlayChoice[];
    return rows.flatMap((_, row) => (["LEFT", "RIGHT"] as Side[]).flatMap((side) => {
      if (Math.abs(row - source.row) > 1 || (row === source.row && side === source.side)) return [];
      return [{ row, side, label: side === source.side ? "Adjacent position" : "Move to this side", state: "destination" as const }];
    }));
  }, [rows, source]);

  const facingChoices: LabOverlayChoice[] = mode === "move" && moveSlot !== null && !facing ? (["LEFT", "RIGHT"] as Side[]).map((side) => ({ row: currentRow, side, label: `Face ${side.toLowerCase()}`, state: "destination" })) : [];
  const overlayChoices = mode === "strategize" && source && !destination ? legalStrategizeDestinations : facingChoices;
  const marineMoveChoices: LabMarineMoveChoice[] = mode === "move" && marine && moveSlot === null && selectedIndex >= 0
    ? [selectedIndex - 1, selectedIndex + 1].filter((row) => row >= 0 && row < rows.length).map((row) => ({ row, label: `${row < selectedIndex ? "Swap up with" : "Swap down with"} ${rows[row].marine.name.replace(/^(Brother|Sergeant) /, "")}` }))
    : [];

  const swarmStates: Record<string, LabTargetState> = {};
  rows.forEach((row, rowIndex) => (["LEFT", "RIGHT"] as Side[]).forEach((side) => {
    const swarm = side === "LEFT" ? row.left.swarm : row.right.swarm;
    if (!swarm) return;
    const key = cellKey(rowIndex, side);
    if (target?.row === rowIndex && target.side === side || source?.row === rowIndex && source.side === side) swarmStates[key] = "selected";
    else if (!complete && mode === "strategize" && !source) swarmStates[key] = "selectable";
    else if (!complete && mode === "attack" && legalAttackTargets.some((cell) => cell.row === rowIndex && cell.side === side)) swarmStates[key] = "targeted";
    else swarmStates[key] = "neutral";
  }));

  const terrainStates: Record<string, LabTargetState> = {};
  if (mode === "move" && facing && !complete) {
    (["LEFT", "RIGHT"] as Side[]).forEach((side) => {
      const flank = side === "LEFT" ? rows[currentRow]?.left : rows[currentRow]?.right;
      if (flank?.terrain) terrainStates[cellKey(currentRow, side)] = "selectable";
    });
  }
  if (terrain) terrainStates[cellKey(terrain.row, terrain.side)] = "selected";

  let prompt: string = MODE_INFO[mode].first;
  let hint: string = "Tap to choose · hold any piece for details";
  if (complete) { prompt = mode === "move" ? "Move + Activate complete" : mode === "attack" ? "Attack target confirmed" : "Swarm destination confirmed"; hint = "Reset the demo or switch interaction modes"; }
  else if (mode === "move" && marine && moveSlot === null) { prompt = `Choose where ${marine.replace(/^(Brother|Sergeant) /, "")} moves`; hint = "Tap the highlighted Marine above or below to swap positions"; }
  else if (mode === "move" && moveSlot !== null && !facing) { prompt = "Choose the Marine's facing"; hint = "Tap the left or right side—even to keep the current facing"; }
  else if (mode === "move" && facing) { prompt = "Activate Terrain, or finish movement"; hint = "Eligible Terrain is highlighted"; }
  else if (mode === "attack" && marine && !target) { prompt = "Choose a swarm in range and facing"; hint = `${marine} · Range ${MARINE_DETAILS[marine]?.range ?? 0}`; }
  else if (mode === "strategize" && source && !destination) { prompt = "Choose a legal swarm destination"; hint = "Adjacent formation position and/or the other side"; }

  const chooseMarine = (name: string) => {
    if (complete) return;
    const row = rows.find((item) => item.marine.name === name);
    if ((mode === "move" && row?.marine.team === "BLUE") || (mode === "attack" && row?.marine.team === "RED")) setMarine(name);
  };
  const chooseSwarm = (row: number, side: Side) => {
    if (complete) return;
    if (mode === "strategize" && !source) setSource({ row, side });
    if (mode === "attack" && legalAttackTargets.some((cell) => cell.row === row && cell.side === side)) { setTarget({ row, side }); setComplete(true); }
  };
  const chooseOverlay = (choice: LabOverlayChoice) => {
    if (mode === "move") setFacing(choice.side);
    else { setDestination({ row: choice.row, side: choice.side }); setComplete(true); }
  };
  const chooseMarineMove = (choice: LabMarineMoveChoice) => {
    if (selectedIndex < 0) return;
    setMoveOrigin(selectedIndex);
    setRows((current) => {
      const next = current.map((row) => ({ ...row }));
      [next[selectedIndex].marine, next[choice.row].marine] = [next[choice.row].marine, next[selectedIndex].marine];
      return next;
    });
    setMoveSlot(choice.row);
  };
  const chooseTerrain = (row: number, side: Side) => {
    if (mode !== "move" || !facing || complete || terrainStates[cellKey(row, side)] !== "selectable") return;
    setTerrain({ row, side }); setComplete(true);
  };
  const back = () => {
    if (complete) { setComplete(false); if (mode === "attack") setTarget(null); else if (mode === "strategize") setDestination(null); else setTerrain(null); return; }
    if (mode === "move") { if (facing) setFacing(null); else if (moveSlot !== null) { if (moveOrigin !== null && selectedIndex >= 0) setRows((current) => { const next = current.map((row) => ({ ...row })); [next[selectedIndex].marine, next[moveOrigin].marine] = [next[moveOrigin].marine, next[selectedIndex].marine]; return next; }); setMoveOrigin(null); setMoveSlot(null); } else setMarine(null); }
    else if (mode === "attack") setMarine(null);
    else setSource(null);
  };

  return <>
    <div className={`lab-choice-banner lab-choice-${MODE_INFO[mode].color.toLowerCase()}`}><span>{MODE_INFO[mode].color} squad · {MODE_INFO[mode].title}</span><strong>{prompt}</strong><em>{hint}</em></div>
    <FormationBoard rows={rows} marineSpriteUrl={marineSpriteUrl} alienSpriteUrl={alienSpriteUrl} broodlordSpriteUrl={broodlordSpriteUrl} marineStates={marineStates} marineMoveChoices={marineMoveChoices} overlayChoices={overlayChoices} swarmStates={swarmStates} terrainStates={terrainStates} onInspect={onInspect} onMarineMoveChoice={chooseMarineMove} onOverlayChoice={chooseOverlay} onSelectMarine={chooseMarine} onSelectSwarm={chooseSwarm} onSelectTerrain={chooseTerrain} />
    <div className="lab-interaction-dock"><button type="button" onClick={back} disabled={!marine && !source}>Back</button><div><span>Board-driven input demo</span><strong>{prompt}</strong></div>{mode === "move" && facing && !complete ? <button type="button" className="is-primary" onClick={() => setComplete(true)}>Finish move</button> : <button type="button" onClick={reset}>Reset</button>}</div>
  </>;
}
