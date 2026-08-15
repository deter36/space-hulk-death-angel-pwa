# Game art normalization

This tool converts the original PixelLab GIF exports into transparent horizontal
PNG sprite strips. It preserves the source canvas and frame positions so the
characters do not jitter between animation states.

```powershell
python tools/normalize-game-art/normalize.py `
  "C:\path\to\Space Hulk Death Angel"
```

The generated `public/game-art/manifest.json` is the runtime contract. All art
uses its native right-facing orientation and may be mirrored for left-facing
characters. The manifest also records frame timing, ground anchors, looping,
one-shot behavior, and the required combat-result playback order.

Source GIFs remain untouched and are not required by the web app.
