"""
split_db.py

One-time (or re-run-as-needed) utility to split a monolithic db.json
into smaller, category-scoped files under data/.

Usage:
    python3 split_db.py path/to/db.json

This is separate from build.py:
  - split_db.py:  monolithic db.json  -> data/*.json   (run rarely, e.g. if
                   you get a fresh full export and want to re-shard it)
  - build.py:     data/*.json         -> dist/index.html (run every time
                   you edit any data/*.json file or the app template)

If you're maintaining data/*.json directly going forward (recommended),
you likely only need this script once, right now.
"""

import json
import sys
from pathlib import Path

# Maps output filename -> list of top-level keys from the source db.json
# that should be written into it.
SCHEMA = {
    "core.json": [
        "weapons", "armors", "rings", "accessories", "brands",
    ],
    "heroes.json": [
        "heroes", "pets", "adventurers",
    ],
    "pet_skills.json": [
        "pet_skills",
    ],
    "mounts.json": [
        "mounts",
    ],
    "artifacts.json": [
        "artifacts",
    ],
    "gems_psionics.json": [
        "gems", "psionics",
    ],
    "relics.json": [
        "relics", "relic_sets",
    ],
    "collectibles.json": [
        "collectibles", "collectible_sets",
    ],
    "progression.json": [
        "story_skills", "inherit_def", "inherit_max", "treasures", "armaments",
    ],
}


def split_db(source_path: Path, data_dir: Path) -> None:
    with source_path.open("r", encoding="utf-8") as f:
        db = json.load(f)

    remaining_keys = set(db.keys())
    data_dir.mkdir(parents=True, exist_ok=True)

    for filename, keys in SCHEMA.items():
        chunk = {}
        for key in keys:
            if key not in db:
                print(f"  [warn] key '{key}' expected for {filename} not found in source db.json")
                continue
            chunk[key] = db[key]
            remaining_keys.discard(key)

        out_path = data_dir / filename
        with out_path.open("w", encoding="utf-8") as f:
            json.dump(chunk, f, indent=2, ensure_ascii=False)
        print(f"  wrote {out_path}  ({', '.join(keys)})")

    if remaining_keys:
        print(f"\n  [warn] these keys were NOT assigned to any output file: {sorted(remaining_keys)}")
        print("  they were skipped. Add them to SCHEMA above and re-run if needed.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python3 split_db.py path/to/db.json")
        sys.exit(1)

    source = Path(sys.argv[1])
    if not source.exists():
        print(f"File not found: {source}")
        sys.exit(1)

    data_dir = Path(__file__).parent / "data"
    print(f"Splitting {source} -> {data_dir}/\n")
    split_db(source, data_dir)
    print("\nDone.")
