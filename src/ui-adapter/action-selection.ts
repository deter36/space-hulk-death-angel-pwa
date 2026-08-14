import { ACTIONS } from "../engine/actions/catalog";
import type { GameState } from "../engine/state/game-state";

export type ActionCardView = {
  actionId: string;
  name: string;
  initiative: number;
  type: "SUPPORT" | "MOVE_ACTIVATE" | "ATTACK";
  summary: string;
  available: boolean;
  unavailableReason: "PREVIOUS_ROUND" | null;
  optionId: string | null;
};

export type ActionSelectionView = {
  team: string;
  decisionId: string;
  cards: ActionCardView[];
};

export function actionSelectionView(state: GameState): ActionSelectionView | null {
  const decision = state.pendingDecision;
  if (!decision || decision.type !== "CHOOSE_ACTION") return null;
  const team = decision.legalOptions[0]?.payload.team as string | undefined;
  if (!team) return null;
  const legalByActionId = new Map(decision.legalOptions.map((option) => [option.payload.actionId as string, option.id]));
  return {
    team,
    decisionId: decision.id,
    cards: ACTIONS.filter((action) => action.team === team).map((action) => ({
      actionId: action.id,
      name: action.name,
      initiative: action.initiative,
      type: action.type,
      summary: action.sourceText,
      available: legalByActionId.has(action.id),
      unavailableReason: legalByActionId.has(action.id) ? null : "PREVIOUS_ROUND",
      optionId: legalByActionId.get(action.id) ?? null,
    })),
  };
}
