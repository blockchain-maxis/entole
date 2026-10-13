"""
Makes the three font files the receipt picture is drawn with.

    python3 apps/web/assets/receipt/make-fonts.py

The picture is drawn on the server (app/api/receipt/[reference]/image), by a
renderer that reads plain font files and cannot ask a font for one of its
features. So the files here are cut from the same fonts the apps use, with two
changes:

  1. Only the letters a receipt can need are kept: Latin with its accents and
     dots (Yoruba and Igbo names among them), punctuation and currency signs.
     That is what takes Source Serif 4 from 330 KB to about a third of that.
  2. In Plus Jakarta Sans the figures are swapped for its own tabular ones
     (the `tnum` feature, made the default), so every digit takes the same
     width in the picture as it does on a screen. Source Serif 4's figures are
     tabular as they come.

It also writes `advances.json`: how wide each letter of the semibold sans is.
The picture is exactly as tall as what it says, so before drawing it the route
has to know how many lines a name or a note will take. It works that out from
these widths instead of guessing, which is why nothing on a receipt is ever
cut short or left hanging over the edge.

And it writes `watermark-word.json`: the outline of the watermark's word in
the display face, as one path. The picture lays the watermark from that
outline directly, so nothing has to be drawn ahead of time to make it. The
word has to be the one in `packages/tokens/design-tokens.js`; a test holds the
two together.

Both fonts are under the SIL Open Font License, which travels with them here
(OFL-*.txt). Needs fontTools (`pip install fonttools`). Run it again only when
the apps change fonts.
"""

import json
from pathlib import Path

from fontTools import subset
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]

SOURCES = {
    "SourceSerif4-SemiBold.ttf": REPO / "apps/mobile/assets/fonts/SourceSerif4_600SemiBold.ttf",
    "PlusJakartaSans-Medium.ttf": REPO
    / "node_modules/@expo-google-fonts/plus-jakarta-sans/500Medium/PlusJakartaSans_500Medium.ttf",
    "PlusJakartaSans-SemiBold.ttf": REPO
    / "node_modules/@expo-google-fonts/plus-jakarta-sans/600SemiBold/PlusJakartaSans_600SemiBold.ttf",
}

# Basic Latin, Latin-1, Latin Extended A and B, modifier letters, combining
# marks, Latin Extended Additional, punctuation, currency (the naira sign is
# U+20A6), the true minus.
KEEP = "U+0020-007E,U+00A0-024F,U+02B0-02FF,U+0300-036F,U+1E00-1EFF,U+2000-206F,U+20A0-20BF,U+2212"

DIGITS = [ord(c) for c in "0123456789"]


def tabular_figures(font: TTFont) -> dict[str, str]:
    """The font's own map from each figure to its tabular form, or {}."""
    found: dict[str, str] = {}
    if "GSUB" not in font:
        return found
    table = font["GSUB"].table
    for record in table.FeatureList.FeatureRecord:
        if record.FeatureTag != "tnum":
            continue
        for index in record.Feature.LookupListIndex:
            for sub in table.LookupList.Lookup[index].SubTable:
                sub = getattr(sub, "ExtSubTable", sub)
                found.update(getattr(sub, "mapping", {}))
    return found


def advances(font: TTFont) -> set[int]:
    cmap = font.getBestCmap()
    return {font["hmtx"][cmap[code]][0] for code in DIGITS}


# The face names and notes are set in: its widths are what lines are counted with.
MEASURED = "PlusJakartaSans-SemiBold.ttf"


def write_advances(font: TTFont) -> None:
    cmap = font.getBestCmap()
    widths = {str(code): font["hmtx"][glyph][0] for code, glyph in sorted(cmap.items())}
    table = {
        "unitsPerEm": font["head"].unitsPerEm,
        # A letter the font does not have is drawn from some other font; count it as a wide one.
        "unknown": max(widths.values()),
        "widths": widths,
    }
    out = HERE / "advances.json"
    out.write_text(json.dumps(table, separators=(",", ":")) + "\n")
    print(f"advances.json: {len(widths)} letters, {out.stat().st_size // 1024} KB")


# The watermark: this word, in this face.
WATERMARK_WORD = "entole"
WATERMARK_FACE = "SourceSerif4-SemiBold.ttf"


def write_watermark_word(font: TTFont) -> None:
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    pen = SVGPathPen(glyphs, ntos=lambda value: str(round(value)))
    along = 0
    for letter in WATERMARK_WORD:
        glyph = cmap[ord(letter)]
        # Letters run left to right; the font's up is the picture's down, so each is flipped.
        glyphs[glyph].draw(TransformPen(pen, (1, 0, 0, -1, along, 0)))
        along += font["hmtx"][glyph][0]
    table = {
        "word": WATERMARK_WORD,
        "unitsPerEm": font["head"].unitsPerEm,
        "width": along,
        # How tall a small letter is: the word is centred on half of this.
        "xHeight": font["OS/2"].sxHeight,
        "path": pen.getCommands(),
    }
    out = HERE / "watermark-word.json"
    out.write_text(json.dumps(table, separators=(",", ":")) + "\n")
    print(f"watermark-word.json: '{WATERMARK_WORD}', {along} wide, {out.stat().st_size} bytes")


def make(name: str, source: Path) -> None:
    options = subset.Options()
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    options.hinting = False
    options.glyph_names = True

    # Keep the font's own dates, so making the files again leaves them byte for byte the same.
    font = TTFont(source, recalcTimestamp=False)
    cutter = subset.Subsetter(options)
    cutter.populate(unicodes=subset.parse_unicodes(KEEP))
    cutter.subset(font)

    if len(advances(font)) > 1:
        swap = tabular_figures(font)
        for table in font["cmap"].tables:
            for code in DIGITS:
                glyph = table.cmap.get(code)
                if glyph in swap:
                    table.cmap[code] = swap[glyph]
    if len(advances(font)) != 1:
        raise SystemExit(f"{name}: the figures are still not one width")
    if 0x20A6 not in font.getBestCmap():
        raise SystemExit(f"{name}: no naira sign")

    out = HERE / name
    font.save(out)
    print(f"{name}: {out.stat().st_size // 1024} KB, figures {advances(font).pop()} wide")
    if name == MEASURED:
        write_advances(font)
    if name == WATERMARK_FACE:
        write_watermark_word(font)


if __name__ == "__main__":
    for name, source in SOURCES.items():
        make(name, source)
