import type { Side } from "@/src/data/types";
import type { PendingDecision } from "@/src/engine";

export type StrategizeOption = PendingDecision["legalOptions"][number];

export function strategizeSwarmIds(decision: PendingDecision | null): string[] {
  if (decision?.type !== "STRATEGIZE") return [];
  return [...new Set(decision.legalOptions.flatMap((option) => typeof option.payload.swarmId === "string" ? [option.payload.swarmId] : []))];
}

export function strategizeDestinationOption(decision: PendingDecision | null, swarmId: string | null, positionIndex: number, side: Side): StrategizeOption | null {
  if (decision?.type !== "STRATEGIZE" || !swarmId) return null;
  return decision.legalOptions.find((option) => option.payload.swarmId === swarmId && option.payload.positionIndex === positionIndex && option.payload.side === side) ?? null;
}
