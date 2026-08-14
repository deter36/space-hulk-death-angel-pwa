# Source discrepancy register

This register prevents silent source reinterpretation. Authority remains FAQ/errata, rulebook, official card text, verified gameplay database, then execution specification.

## Resolved for implementation

### Marines `Facing` column contains team colors

The workbook's Marines sheet uses the `Facing` column for the same color value already stored in `Team`. Initial facing is determined during setup, not by this column. The importer validates that the values equal `Team`, reports the anomaly, and excludes the column from runtime Marine definitions.

### Counter Attack FAQ names Brother Valencio

The FAQ question says Brother Valencio, but official card data assigns Counter Attack to Sergeant Lorenzo. The clarification is treated as a general facing ruling for Counter Attack; no ability is assigned to Valencio.

### Odd final card during equally-as-possible blip refill

If limited supply cannot satisfy both piles and equal placement leaves one extra card, allocation of the extra card is a meaningful current-player choice. The engine will emit a pending decision rather than silently favoring a side.

### Deterministic solo setup conventions

The official ordered setup sequence is authoritative. Within Location-deck setup, only the tiers named by the solo Setup Location consume RNG, in printed top-to-bottom order (`2`, `3`, `4`). During Blip setup, the left pile is filled to six before the right pile is filled to six. These conventions make hidden state reproducible without changing any published choice or setup count.

### Same-title Event variants

“Out of Thin Air” and “The Swarm” each have two physical cards with identical title and effect text but different movement icons. Each physical variant receives a distinct definition ID and `copyIndex`, while the printed title remains the shared display name. The importer rejects collapsing these variants into a quantity-two definition.

### Corrected Location data

The corrected workbook fixes three Terrain placements plus several Location tiers and Blip counts. Every Location now references four distinct physical Terrain types. The importer enforces that uniqueness so the earlier duplicate-Terrain data error cannot silently return.

## Accepted source boundary

Card scans are intentionally excluded. Exact card text and card facts come from the verified workbook. Future artwork may be attached by stable definition ID but may not become gameplay authority.
