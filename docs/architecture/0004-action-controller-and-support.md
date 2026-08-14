# ADR 0004: Advance-until-blocked controller and Support Actions

Status: Accepted

## Decision

The public engine controller advances mandatory mechanics until it reaches a meaningful player decision, game end, or an explicitly marked implementation boundary. `newGame`, `submitDecision`, and `advanceAutomatic` all return canonical state, emitted transitions, and the current pending decision.

Action selection is collected one active Combat Team at a time for the solo player, but cards remain in hand until all teams have chosen. The engine then locks all choices simultaneously and resolves them in ascending initiative order. A submitted option is valid only when it belongs to the exact currently pending decision.

The Support base action always offers every surviving Marine as a legal recipient when a token remains in supply. Block, Defensive Stance, Counter Attack, and Overwatch create typed round effects for their later timing windows. Strategize and Power Field create immediate optional decisions. Strategize merges its destination only during Action cleanup; Power Field carries whole-merged-swarm propagation through the end of the round.

## Interface

- `newGame(config)` returns the first Action-selection decision after setup.
- `submitDecision(state, decisionId, optionId)` validates and advances until the next decision.
- `advanceAutomatic(state)` resumes mandatory processing without accepting fabricated input.
- `actionSelectionView(state)` displays all three cards, including unavailable previous-round cards and reasons, while submit controls come only from legal engine options.

## Invariants

- Exactly one checkpoint corresponds to a pending decision.
- Decision option IDs are non-empty and unique.
- An Action appears no more than once in the initiative queue.
- Support conservation is checked after every placement transition.
- Swarm movement and cleanup preserve every individual Genestealer identity and active effect.
