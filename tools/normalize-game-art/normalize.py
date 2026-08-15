"""Convert PixelLab GIF exports into transparent, deterministic sprite strips."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageSequence


@dataclass(frozen=True)
class AnimationSpec:
    entity: str
    state: str
    source_dir: str
    source_name: str
    output_name: str
    loop: bool
    retain_last_frame: bool = False
    trajectory: str | None = None


ANIMATIONS = (
    AnimationSpec("marine", "idle", "Marine", "Marine idle.gif", "idle.png", True),
    AnimationSpec("marine", "fire", "Marine", "fire gun straight.gif", "fire-straight.png", False, trajectory="straight"),
    AnimationSpec("marine", "fire", "Marine", "fire gun up.gif", "fire-up.png", False, trajectory="up"),
    AnimationSpec("marine", "fire", "Marine", "fire gun down.gif", "fire-down.png", False, trajectory="down"),
    AnimationSpec("marine", "gunJam", "Marine", "gun jam straight.gif", "gun-jam-straight.png", False, trajectory="straight"),
    AnimationSpec("marine", "gunJam", "Marine", "gun jam up.gif", "gun-jam-up.png", False, trajectory="up"),
    AnimationSpec("marine", "gunJam", "Marine", "gun jam down.gif", "gun-jam-down.png", False, trajectory="down"),
    AnimationSpec("marine", "dodge", "Marine", "marine dodge.gif", "dodge.png", False),
    AnimationSpec("marine", "death", "Marine", "marine death.gif", "death.png", False, True),
    AnimationSpec("genestealer", "idle", "Genestealer", "alien idle.gif", "idle.png", True),
    AnimationSpec("genestealer", "attack", "Genestealer", "Alien attack.gif", "attack.png", False),
    AnimationSpec("genestealer", "death", "Genestealer", "alien shot.gif", "death.png", False, True),
    AnimationSpec("broodlord", "idle", "Genestealer", "broodlord idle.gif", "idle.png", True),
)

ANCHORS = {
    "marine": {"x": 46, "y": 78},
    "genestealer": {"x": 66, "y": 96},
    "broodlord": {"x": 66, "y": 96},
}


def remove_green_screen(frame: Image.Image) -> Image.Image:
    """Key PixelLab's green screen while keeping pixel-art edges crisp."""
    rgba = frame.convert("RGBA")
    pixels = list(rgba.get_flattened_data())
    keyed: list[tuple[int, int, int, int]] = []

    for red, green, blue, alpha in pixels:
        green_dominance = green - max(red, blue)
        if green >= 150 and green_dominance >= 45:
            keyed.append((0, 0, 0, 0))
        else:
            keyed.append((red, green, blue, alpha))

    rgba.putdata(keyed)
    return rgba


def animation_key(spec: AnimationSpec) -> str:
    return f"{spec.state}-{spec.trajectory}" if spec.trajectory else spec.state


def normalize_animation(spec: AnimationSpec, source_root: Path, output_root: Path) -> dict[str, object]:
    source_path = source_root / spec.source_dir / spec.source_name
    if not source_path.exists():
        raise FileNotFoundError(f"Missing source animation: {source_path}")

    with Image.open(source_path) as source:
        frames = [remove_green_screen(frame) for frame in ImageSequence.Iterator(source)]
        durations = [
            int(frame.info.get("duration", source.info.get("duration", 200)))
            for frame in ImageSequence.Iterator(source)
        ]
        frame_width, frame_height = source.size

    if len(set(durations)) != 1:
        raise ValueError(f"Variable frame timing is not supported: {source_path}")

    sheet = Image.new("RGBA", (frame_width * len(frames), frame_height), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        sheet.alpha_composite(frame, (index * frame_width, 0))

    entity_output = output_root / spec.entity
    entity_output.mkdir(parents=True, exist_ok=True)
    output_path = entity_output / spec.output_name
    sheet.save(output_path, "PNG", optimize=True)

    return {
        "state": spec.state,
        "trajectory": spec.trajectory,
        "src": f"/game-art/{spec.entity}/{spec.output_name}",
        "frameWidth": frame_width,
        "frameHeight": frame_height,
        "frameCount": len(frames),
        "frameDurationMs": durations[0],
        "totalDurationMs": durations[0] * len(frames),
        "loop": spec.loop,
        "retainLastFrame": spec.retain_last_frame,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source_root", type=Path, help="Folder containing Marine and Genestealer source folders")
    parser.add_argument(
        "--output-root",
        type=Path,
        default=Path("public/game-art"),
        help="Project output directory (default: public/game-art)",
    )
    args = parser.parse_args()

    output_root = args.output_root.resolve()
    manifest: dict[str, object] = {
        "version": 1,
        "nativeFacing": "right",
        "playbackOrder": {
            "marineAttack": ["dieResult", "marine.fire|marine.gunJam", "genestealer.death?", "boardUpdate"],
            "genestealerAttack": ["genestealer.attack", "dieResult", "marine.dodge|marine.death", "boardUpdate"],
        },
        "entities": {},
    }

    for spec in ANIMATIONS:
        entities = manifest["entities"]
        assert isinstance(entities, dict)
        entity = entities.setdefault(
            spec.entity,
            {"anchor": ANCHORS[spec.entity], "animations": {}},
        )
        assert isinstance(entity, dict)
        animations = entity["animations"]
        assert isinstance(animations, dict)
        animations[animation_key(spec)] = normalize_animation(spec, args.source_root, output_root)

    manifest_path = output_root / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Normalized {len(ANIMATIONS)} animations into {output_root}")


if __name__ == "__main__":
    main()
