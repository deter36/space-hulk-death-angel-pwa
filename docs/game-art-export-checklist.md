# Space Hulk: Death Angel — Production Art Export Checklist

This is the handoff guide for turning the approved visual direction in `ProofBitMapped` into reusable, responsive game UI.

## What the web app needs

The game supplies all words and numbers itself: action type, initiative, card name, rules text, team name, round, phase, and counts. Artwork should therefore provide the illustrated **surfaces and ornaments**, with open / transparent areas wherever the app writes text.

Do not bake changing game text into production artwork. The proof sheet is excellent visual direction, but it is a reference image rather than a reusable card system.

## Priority 1 — action-card kit

These assets unlock the first visual pass. Export each item as a separate transparent file.

| Asset | Quantity | Purpose | Notes |
| --- | ---: | --- | --- |
| Full action-card frame | 6 | Expanded hand: Support, Move + Activate, Attack | One each for Blue, Green, Grey, Purple, Red, Yellow. Include rough outer frame, tinted glass/texture, team splatters, and any corner ornament. Leave the text regions clear. |
| Compact action-card frame | 6 | Chosen cards in the bottom resolving-actions tray | Same visual family, optimized for a shallow horizontal card. This can be omitted if the full frame scales down cleanly. |
| Mini-card back / edge | 6 or 1 neutral | The three splayed cards before selection | Must remain legible at a very small size. A common dark frame with app-applied team tint is acceptable. |
| Initiative medallion / badge | 6 or 1 neutral | Large initiative number at a card's upper-right | Export without a numeral. The app places the number itself. A common neutral badge is acceptable if it works with every squad tint. |
| Unavailable-card overlay | 1 | Red X over a card that cannot be played | Transparent artwork, no card frame behind it. This may remain CSS if a painted X is not worthwhile. |

### Full-card layout safe zones

For a vertical card, please reserve clear space for dynamic text:

- **Top left:** action type (Support / Move + Activate / Attack)
- **Top right:** initiative badge
- **Upper-middle:** card name, one to two lines
- **Lower-middle:** rules text, two to six lines

The proof's dark glass panel and colored paint treatment are exactly the kind of surface to keep; the card title and rules should not be part of the exported frame.

### Suggested source dimensions

There is no single magic pixel size because the app scales for different phones. A useful working source is **720 × 1200 px** for a full card and **720 × 420 px** for a compact card, with transparent edges. Higher-resolution source is welcome. We will render these responsively in HTML, so they must not include a solid background outside the card silhouette.

## Priority 2 — shared HUD kit

These would let us bring the new illustrated language into the rest of the game without redesigning its functionality.

| Asset | Quantity | Notes |
| --- | ---: | --- |
| Wide header / status-panel frame | 1 | A texture/frame for the top mission tray. Transparent center or a dark, low-contrast center behind dynamic text. |
| Small numeric counter badge | 1–2 | For blip piles, support supply, or round count. No numeral baked in. |
| Info-panel frame | 1 | Wide, shallow frame for the bottom notification tray. |
| Menu container frame | 1 | Optional: the existing weathered pewter menu can later be matched to the card treatment. |
| Menu button plate | 1 | Optional bronze / bolted plate with no label. |
| Hamburger, undo, and info tab ornaments | optional | Only needed if hand-drawn icons are desired; the functional buttons already exist. |

## Delivery format

For every reusable asset, provide both when practical:

1. **SVG** for crisp frames, borders, badges, and line art. Convert final illustration shapes to paths where possible and avoid machine-specific font dependencies.
2. **PNG** for painterly / bitmap textures, paint splatter, and effects that do not export nicely as SVG. Use transparent background and at least 2× the intended display resolution.

An editable source file is also helpful but optional: `.svg`, Illustrator `.ai`, Inkscape `.svg`, Photoshop `.psd`, or Krita `.kra`, with the frame, badge, texture, splatters, and text on separate layers. It does **not** need to be cleaned for web; the exports above are what the app will use.

## File naming

Suggested filenames:

```text
game-art/ui/action-card/frame-blue.svg
game-art/ui/action-card/frame-green.svg
game-art/ui/action-card/frame-grey.svg
game-art/ui/action-card/frame-purple.svg
game-art/ui/action-card/frame-red.svg
game-art/ui/action-card/frame-yellow.svg
game-art/ui/action-card/initiative-badge.svg
game-art/ui/action-card/unavailable-x.png
game-art/ui/hud/status-frame.png
game-art/ui/hud/info-frame.png
```

Lowercase, hyphenated names avoid deployment problems.

## Font information to send separately

Please provide the exact font family name(s), weights used, and whether the font can legally be bundled as a web font. If that is not possible, a font sample or a close free substitute is enough—we can keep all important gameplay text accessible and readable while matching the illustrated art.

## Integration plan in the app

When the Priority 1 kit arrives, we will keep a single reusable action-card layout and layer these parts behind dynamic game data:

```text
illustrated frame
├── action type (HTML text)
├── initiative badge + number (HTML text)
├── card title (HTML text)
└── rules text (HTML text)
```

That one component will render the expanded selection cards, the selected-card tray, and the details shown on hold/hover. The game engine and card rules are unaffected.
