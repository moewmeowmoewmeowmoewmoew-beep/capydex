"""
build.py

Merges every JSON file in data/ into one object and injects it into
template.html, producing a single, fully self-contained docs/index.html (docs/, not dist/, so GitHub Pages can serve it directly with zero extra config).

Run this every time you:
  - edit any file in data/ (new relics, updated gem values, etc.)
  - edit template.html / your app JS

Usage:
    python3 build.py
"""

import json
import shutil
from pathlib import Path

PROJECT_DIR = Path(__file__).parent
DATA_DIR = PROJECT_DIR / "data"
SRC_DIR = PROJECT_DIR / "src"
ASSETS_DIR = PROJECT_DIR / "assets"
TEMPLATE_PATH = PROJECT_DIR / "template.html"
OUTPUT_DIR = PROJECT_DIR / "docs"
OUTPUT_PATH = OUTPUT_DIR / "index.html"

DB_TOKEN = "/*__DB_JSON__*/"
CSS_TOKEN = "/*__APP_CSS__*/"
JS_TOKEN = "/*__APP_JS__*/"


def merge_data(data_dir: Path) -> dict:
    merged = {}
    files = sorted(data_dir.glob("*.json"))
    if not files:
        raise SystemExit(f"No .json files found in {data_dir}")

    for path in files:
        with path.open("r", encoding="utf-8") as f:
            chunk = json.load(f)

        overlap = set(chunk.keys()) & set(merged.keys())
        if overlap:
            raise SystemExit(
                f"Key collision: {overlap} appears in both an earlier file "
                f"and {path.name}. Each top-level key must live in exactly one file."
            )

        merged.update(chunk)
        print(f"  merged {path.name}  ({', '.join(chunk.keys())})")

    return merged


def copy_assets() -> int:
    """Copy assets/images/** into docs/assets/images/** so the built site can
    reference them by relative path. Returns count of real image files copied
    (ignores .gitkeep placeholders)."""
    src = ASSETS_DIR / "images"
    dst = OUTPUT_DIR / "assets" / "images"
    if not src.exists():
        return 0
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns(".gitkeep"))
    return sum(1 for p in dst.rglob("*") if p.is_file())


def build() -> None:
    print(f"Reading data from {DATA_DIR}/")
    merged = merge_data(DATA_DIR)

    print(f"\nReading template {TEMPLATE_PATH}")
    template_html = TEMPLATE_PATH.read_text(encoding="utf-8")

    for token, path in [(DB_TOKEN, None), (CSS_TOKEN, SRC_DIR / "app.css"), (JS_TOKEN, SRC_DIR / "app.js")]:
        if token not in template_html:
            raise SystemExit(
                f"Injection token '{token}' not found in {TEMPLATE_PATH}."
            )

    db_json = json.dumps(merged, ensure_ascii=False)
    css_content = (SRC_DIR / "app.css").read_text(encoding="utf-8")
    js_content = (SRC_DIR / "app.js").read_text(encoding="utf-8")

    output_html = template_html.replace(DB_TOKEN, db_json)
    output_html = output_html.replace(CSS_TOKEN, css_content)
    output_html = output_html.replace(JS_TOKEN, js_content)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(output_html, encoding="utf-8")

    image_count = copy_assets()

    size_kb = OUTPUT_PATH.stat().st_size / 1024
    print(f"\nWrote {OUTPUT_PATH}  ({size_kb:.1f} KB)")
    if image_count:
        print(f"Copied {image_count} image(s) to {OUTPUT_DIR / 'assets' / 'images'}")
        print("This build now depends on docs/assets/ being alongside index.html — "
              "no longer single-file-portable once images are added.")
    else:
        print("No images found in assets/images/ yet — still single-file-portable for now.")


if __name__ == "__main__":
    build()
