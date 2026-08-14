import { Sha256CounterRng } from "../rng/sha256-counter";
import type { GameState } from "../state/game-state";
import type { ComponentZone } from "../state/zones";
import { commitTransition } from "../transitions/commit";
import type { TransitionRecord } from "../transitions/types";
import { assertStateInvariants } from "../validation/invariants";

const REBUILDABLE: Record<string, string | null> = {
  "event.deck": "event.discard",
  "genestealer.deck": "genestealer.discard",
  "location.deck": null,
  "blip.left": null,
  "blip.right": null,
};

export class DrawUnavailableError extends Error {
  readonly code = "DRAW_UNAVAILABLE";
}

export type DrawDestination = {
  zone: ComponentZone;
  containerId: string | null;
};

export type DrawResult = {
  cardId: string;
  transitions: TransitionRecord[];
};

export function drawCard(
  state: GameState,
  rng: Sha256CounterRng,
  sourceId: keyof typeof REBUILDABLE,
  destination: DrawDestination,
  place?: (cardId: string) => void,
): DrawResult {
  assertStateInvariants(state);
  const source = state.orderedSources[sourceId];
  if (!source) throw new DrawUnavailableError(`Authoritative ordered source is missing: ${sourceId}`);
  const transitions: TransitionRecord[] = [];

  if (source.length === 0) {
    const discardId = REBUILDABLE[sourceId];
    if (discardId === null) throw new DrawUnavailableError(`Ordered source cannot rebuild: ${sourceId}`);
    const discard = state.orderedSources[discardId];
    if (!discard?.length) throw new DrawUnavailableError(`No cards available to rebuild: ${sourceId}`);
    const shuffled = rng.shuffle(discard);
    const resultingRng = rng.snapshot();
    transitions.push(commitTransition(state, "PILE_SHUFFLED", sourceId, () => {
      state.orderedSources[sourceId] = shuffled;
      state.orderedSources[discardId] = [];
      for (const cardId of shuffled) {
        state.components[cardId].zone = "DECK";
        state.components[cardId].containerId = sourceId;
      }
      state.rng = resultingRng;
    }, {
      randomInputs: [{ operationSeq: resultingRng.operationSeq, kind: "SHUFFLE", sourceId: discardId, cardId: null, preLength: discard.length, postLength: shuffled.length, resultingRng }],
    }));
  }

  const pile = state.orderedSources[sourceId];
  if (pile.length === 0) throw new DrawUnavailableError(`Ordered source is empty: ${sourceId}`);
  const preLength = pile.length;
  const cardId = pile[0];
  rng.recordDraw();
  const resultingRng = rng.snapshot();
  transitions.push(commitTransition(state, "CARD_DRAWN", sourceId, () => {
    state.orderedSources[sourceId] = pile.slice(1);
    state.components[cardId].zone = destination.zone;
    state.components[cardId].containerId = destination.containerId;
    place?.(cardId);
    state.rng = resultingRng;
  }, {
    randomInputs: [{ operationSeq: resultingRng.operationSeq, kind: "DRAW", sourceId, cardId, preLength, postLength: preLength - 1, resultingRng }],
    mutations: [{ path: `components.${cardId}.zone`, operation: "MOVE", value: destination.zone }],
  }));
  return { cardId, transitions };
}
