#!/usr/bin/env python3
"""
Draws the Selestial logo files: the mark beside the name, and the mark above the name.

The name is set in Plus Jakarta Sans, bold, and turned into outlines so the files look the same
everywhere and need no font. That typeface is used for the logo only: the app's own type stays Inter,
and the font file in scripts/fonts is never loaded by the site. Colours are the owner's palette. Run after the mark, the palette or
the lettering changes, then run `node scripts/generate-logo-png.mjs` and commit the results:

    pip install fonttools brotli
    python3 scripts/generate-logo.py

Writes public/brand/selestial-logo{,-violet,-white}.svg, selestial-logo-stacked{,-white}.svg, and
src/components/brand/wordmark.ts (the name's outline, for the logo inside the app).
"""
import re
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "brand"

VIOLET = "#6838EF"
DEEP_VIOLET = "#5126C7"
PLUM = "#211A35"
WHITE = "#FFFFFF"

NAME = "Selestial"
MARK_W, MARK_H = 58.43, 100.0
CAP = 48.0        # height of the capital S, against a mark 100 tall
TRACK = -0.02     # space added after each letter, in ems
GAP = 24.0        # between the mark and the name
PAD = 8.0

# The mark is kept in one place: the icon script.
MARK = max(re.findall(r'"(M[\d\s.,A-Za-z-]+Z)"', (ROOT / "scripts" / "generate-icons.mjs").read_text()), key=len)

font = instancer.instantiateVariableFont(TTFont(ROOT / "scripts" / "fonts" / "PlusJakartaSans-latin.woff2"), {"wght": 700})
glyphs, cmap, upm = font.getGlyphSet(), font.getBestCmap(), font["head"].unitsPerEm
cap_units = font["OS/2"].sCapHeight
scale = CAP / cap_units
size_units = upm


def name_paths(x0: float, baseline: float) -> tuple[str, float]:
    """The name as one outline starting at x0, and the x where it ends."""
    x, parts = x0, []
    for index, char in enumerate(NAME):
        glyph = glyphs[cmap[ord(char)]]
        pen = SVGPathPen(glyphs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
        glyph.draw(TransformPen(pen, (scale, 0, 0, -scale, x, baseline)))
        parts.append(pen.getCommands())
        x += glyph.width * scale
        if index < len(NAME) - 1:
            x += TRACK * size_units * scale
    return "".join(parts), x


def svg(width: float, height: float, body: str, defs: str = "") -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.2f} {height:.2f}" width="{width:.0f}" height="{height:.0f}" role="img" aria-label="Selestial">'
        f"<title>Selestial</title>{defs}{body}</svg>\n"
    )


def gradient(x1: float, x2: float) -> str:
    return (
        f'<defs><linearGradient id="v" gradientUnits="userSpaceOnUse" x1="{x1:.2f}" y1="0" x2="{x2:.2f}" y2="{MARK_H + 2 * PAD:.2f}">'
        f'<stop offset="0" stop-color="{VIOLET}"/><stop offset="1" stop-color="{DEEP_VIOLET}"/></linearGradient></defs>'
    )


def beside(mark_fill: str, name_fill: str, defs: bool) -> str:
    baseline = PAD + MARK_H / 2 + CAP / 2
    text, end = name_paths(PAD + MARK_W + GAP, baseline)
    body = f'<path fill="{mark_fill}" transform="translate({PAD} {PAD})" d="{MARK}"/><path fill="{name_fill}" d="{text}"/>'
    return svg(end + PAD, MARK_H + 2 * PAD, body, gradient(PAD, PAD + MARK_W) if defs else "")


def stacked(mark_fill: str, name_fill: str, defs: bool) -> str:
    cap, gap = CAP * 0.62, 20.0
    global scale
    keep, scale = scale, cap / cap_units
    text, end = name_paths(0, 0)
    width = end + 2 * PAD
    text, _ = name_paths(PAD, PAD + MARK_H + gap + cap)
    scale = keep
    mark_x = (width - MARK_W) / 2
    body = f'<path fill="{mark_fill}" transform="translate({mark_x:.2f} {PAD})" d="{MARK}"/><path fill="{name_fill}" d="{text}"/>'
    return svg(width, PAD + MARK_H + gap + cap + PAD, body, gradient(mark_x, mark_x + MARK_W) if defs else "")


FILES = {
    "selestial-logo.svg": beside("url(#v)", PLUM, True),            # for light backgrounds
    "selestial-logo-violet.svg": beside("url(#v)", VIOLET, True),   # one colour, for light backgrounds
    "selestial-logo-white.svg": beside(WHITE, WHITE, False),        # for violet or dark backgrounds
    "selestial-logo-stacked.svg": stacked("url(#v)", PLUM, True),
    "selestial-logo-stacked-white.svg": stacked(WHITE, WHITE, False),
}

# The name alone, sitting on a box as tall as its capital, for the logo component in the app.
_text, _end = name_paths(0, CAP)
(ROOT / "src" / "components" / "brand" / "wordmark.ts").write_text(
    "/** The name \"Selestial\" as an outline, drawn by scripts/generate-logo.py. Do not edit by hand. */\n"
    f"export const WORDMARK = {{ width: {_end:.2f}, height: {CAP:.2f}, path: \"{_text}\" }} as const;\n"
)

OUT.mkdir(parents=True, exist_ok=True)
for name, content in FILES.items():
    (OUT / name).write_text(content)
    print(f"public/brand/{name}  {len(content)} bytes")
