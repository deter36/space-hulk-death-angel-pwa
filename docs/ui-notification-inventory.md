# UI notification inventory

Reviewed from the current client implementation on 2026-08-18. This is a copy-editing and tutorial-planning reference: it records what a player can currently see, not engine-only transitions.

## Reading this document

- **Surface** says where it appears: full-screen notice, the bottom Info rail, a die screen, or a board selection state.
- Text in `{braces}` is generated from live game data.
- **Buttons** lists the literal label or the label pattern the player sees.
- A board selection has no extra button by design; the highlighted object is the control.

## Global and setup

| Trigger | Surface | Heading / body | Buttons |
| --- | --- | --- | --- |
| New mission setup | Setup screen | `Select three combat teams` / `The formation is randomized after your team choice, just like the physical game.` | `Begin mission`; `Guided tutorial` |
| Squad-card review | Full-screen squad overlay | `{COLOR} squad` / `Action cards`, squad member names and ranges, all three card texts | `×` or tap outside |
| Game menu | Header menu | No heading. Rows: `Undo`, `Download save`, `Rules reference`, `New mission` | Respective row; New mission confirms in the browser |
| Detail inspection | Full-screen detail overlay | Source-specific detail: card, Marine, Terrain, Location, or Event text | Tap outside / return control |

## Action selection and action resolution

| Trigger | Surface | Heading / body | Buttons / input |
| --- | --- | --- | --- |
| Choose squad card | Bottom card rail | Expanded hand: `{COLOR} squad` / `Choose an action`; every card shows type, initiative, name, and printed text | Tap a card, then `Select action`; `×` or tap the hand again closes it |
| Tutorial card restriction | Bottom card rail | Coach text: `Choose Support`, `Choose Move + Activate`, or `Choose Attack` with the lesson explanation | Only the lesson’s card type is active; others show the unavailable X |
| Action begins | Full-screen notice | `{COLOR} team · Initiative {N}` / `{Card Name}` / printed card text / action type | `Proceed` |
| Attack has no valid target | Full-screen notice | `{COLOR} squad · Attack` / `{Card Name}` / `No eligible Genestealers are in range and facing for this squad. The attack action ends without a roll.` | `Proceed` |
| All selected actions finish | Full-screen notice | `Phase transition` / `Genestealer attacks` / `The selected squad actions are complete. Resolve each engaged Genestealer swarm in order.` | `Proceed` |
| Start next round | Full-screen notice | `Round {N}` / `Choose a new action card for each active squad.` | `Proceed` |

### Action and ability choices

| Decision | Bottom Info rail heading | Instruction | Button / board input |
| --- | --- | --- | --- |
| Place Support | `{Card Name} — Place support` | `Choose a highlighted Marine for Support.` | Tap a highlighted Marine |
| Strategize | `{Card Name} — Place support` | First: `Choose a highlighted swarm to move.` Then: `Choose a highlighted destination.` | Tap swarm, then destination; `Choose another swarm` resets the first choice |
| Power Field | `{Card Name} — Place support` | Generic `Choose an option.` | Engine-supplied option label |
| Move a Marine | `{Card Name} — Move + Activate` | First: `Choose a highlighted Marine to move.` Then: `Choose a highlighted destination.` | Tap Marine, then the full destination space |
| Set facing | `{Card Name} — Move + Activate` | `Choose a side for the highlighted Marine.` | Tap the left or right adjacent formation tile |
| Activate Terrain | `{Card Name} — Move + Activate` | `Choose highlighted Terrain to activate.` | Tap glowing Terrain |
| Onward Brothers! | `{Card Name} — Move + Activate` | Generic `Choose an option.` | Engine-supplied option label |
| Stealth Tactics, first blip choice | `{Card Name} — Move + Activate` | Generic `Choose an option.` | `Discard top left`, `Discard top right`, then `Do not discard` |
| Stealth Tactics, second choice | `{Card Name} — Move + Activate` | Generic `Choose an option.` | Remaining legal blip option / decline |
| Forward Scouting | Dedicated Forward Scouting overlay | Full drawn Event information, then `Choose where to return this event` | Each destination option; board-return button while inspecting the formation |
| Intimidation roll / pick / destination | `{Card Name} — Move + Activate` then board/slay overlay | Pick instruction: `Choose a highlighted swarm to return to a Blip pile.` | Roll choice, tap swarm, then select its blip pile |
| Select attacker | `{Card Name} — Attack` | `Choose a highlighted Marine.` | Tap highlighted Marine |
| Select target | `{Card Name} — Attack` | `Choose a highlighted Genestealer target.` | Tap highlighted swarm |
| Run and Gun bonus attack | `{Card Name} — Move + Activate` | Generic `Choose an option.` | Engine-supplied option label / board target where applicable |
| Lead by Example | `{Card Name} — Attack` | Generic `Choose an option.` | Engine-supplied option label |
| Successful attack kill | Zoomed swarm overlay | `Attack confirmed` / `Choose a Genestealer to slay` / `Tap its icon in the zoomed swarm.` | Tap a Genestealer icon; `Stop slaying` only where legal |
| Heroic Charge kill | Zoomed swarm overlay | `Heroic Charge` / `Choose a Genestealer to slay` / `Choose one Genestealer from the selected swarm.` | Tap a Genestealer icon |

## Dice and combat

| Trigger | Surface | Heading / body | Buttons |
| --- | --- | --- | --- |
| Any combat die | Full-screen die result | `{Combat die or Genestealer attack}` / animated red die / outcome text such as hit, miss, defense, or special result | `Skip roll` while rolling; then `Proceed` |
| Support reroll available | Full-screen die result | Same die result plus `Keep this result or spend Support to reroll?` | `Keep result`; `Reroll` |
| Start Genestealer attack | Bottom Info rail with board attacker/defender highlight | `Swarm attacking {Marine}` | `Proceed to attack` |
| Counter Attack kill | Bottom Info rail / board selection | `Choose the attacking Genestealer to slay.` | Tap highlighted attacking swarm, then icon if needed |
| Genestealer attacks complete | Full-screen notice | `Phase transition` / `Event phase` / `Genestealer attacks are complete. Draw and resolve the next Event card.` | `Proceed` |

## Events, blips, and movement

| Trigger | Surface | Heading / body | Buttons / input |
| --- | --- | --- | --- |
| Reveal Event | Full-screen notice | `Event reveal` / `{Event Name}` / full printed event text. Meta line currently lists spawn activations and movement icon. | `Resolve event` |
| Event asks for a Marine | Bottom Info rail / board | Source Event name; instruction is usually generic. Rescue specifically says `Choose a slain Marine.` | Engine-supplied options or highlighted Marine |
| Event asks for swarm, blip, team, count, or attack | Bottom Info rail / board | Source Event name; generic `Choose an option.` unless there is a special instruction | Engine-supplied options / highlighted board target |
| Event forced attack and reroll | Bottom Info rail then die result | Event name; die screen uses normal `Keep result` / `Reroll` controls | Same as combat die |
| Event slay | Zoomed swarm overlay | `Event effect` / `Choose a Genestealer to slay` / `Choose one Genestealer from the selected swarm.` | Tap a Genestealer icon |
| Event spawn priority | Bottom Info rail | Source Event name; generic `Choose an option.` | One legal terrain-order label |
| Spawn activation finishes | Bottom Info rail, formation stays visible | `Spawn activations` / `{N} Genestealer(s) spawned` / `Both Event activations are shown on the brightly highlighted Terrain positions.` | `Begin movement` |
| Start event movement | Bottom Info rail | `{N} swarm(s) ready to move` | `Begin movement` |
| Movement is visible | Board animation | `Genestealer movement` / `{N} swarm(s) moving` / `The formation stays visible while every matching swarm advances or flanks.` | No extra input; animation resolves |
| No swarm matches movement icon | Full-screen notice | `Genestealer movement` / `No swarms move` / `No Genestealer swarm matches this Event card's movement icon.` | `Proceed` |

## Travel and new locations

| Trigger | Surface | Heading / body | Buttons / input |
| --- | --- | --- | --- |
| Travel starts | Full-screen notice | `Travel` / `Travel begins` / `Resolve Door effects and any required travel choices before revealing the next Location.` | `Proceed` |
| Door support slay | Board then zoomed swarm overlay | Bottom instruction: `Choose a highlighted swarm to slay with Door support.` | Tap a swarm, then a Genestealer icon; `End Door ability` |
| Begin travel animation | Bottom Info rail | `Ready to travel` | `Travel` |
| New Location arriving | Bottom Info rail | `New location ready` | Engine label: `Reveal Location` |
| New Location revealed | Full-screen notice | `New location` / `{Location Name}` / full location text and metadata | `Proceed` |
| Place Artefact | Bottom Info rail | Artefact printed ability is also shown. Instruction: `Choose a highlighted empty flank.` | Tap empty flank |
| Apothecarion facing | Bottom Info rail / board | Generic `Choose an option.` | Choose facing |
| Teleportarium Marine | Bottom Info rail / board | Generic `Choose an option.` | Choose eligible Marine |
| Core Cogitator / Launch Control | Bottom Info rail / board | Generic `Choose an option.` | Choose eligible Terrain / target |

## Current tutorial copy

The HUD tour is six click-through steps, each with **Skip tour** and **Next** (the final button is **Start command**):

1. `Your strike force` — Marines remaining and the unspent Support supply.
2. `Round counter` — a round starts by selecting cards.
3. `Current phase` — actions, Genestealer attacks, or Event.
4. `Mission tray` — Location, Event, blip piles, and hold-for-details behavior.
5. `The formation` — Marines center; Genestealers on flanks; Terrain behind swarms.
6. `Command rail` — action selection and card/info swipe behavior.

After that, the current in-game tutorial coach is contextual but not yet a fully authored scripted scenario. It currently has copy for Support placement, moving, Terrain activation, attacker/target selection, successful kills, Genestealer defense, and Event resolution. This is the section to replace with your authored tutorial script.

## Review checklist

- Mark any row whose wording should change.
- Add a **tutorial beat ID** beside each notification you want included in the scripted lesson.
- For each beat, specify whether it should be: **explain only**, **highlight**, **force the next input**, or **allow free choice after explaining**.
- Call out any message that should be suppressed during the tutorial because the tutorial overlay itself explains it.

Source of truth: `app/game-client.tsx`, especially `resolutionNoticesFrom`, `decisionInstruction`, `conciseDecisionButtonLabel`, `RollResult`, and `SlaySwarmOverlay`.
