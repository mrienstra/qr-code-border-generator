#!/usr/bin/env python3
"""Generate a QR code border SVG from a plain QR code SVG."""

import re
import xml.etree.ElementTree as ET

INPUT_SVG = "qr-code-original.svg"
QR_SIZE = 33  # 33x33 modules


def parse_qr(svg_path: str) -> set[tuple[int, int]]:
    """Parse QR code SVG and return a set of (col, row) coordinates, 0-indexed."""
    tree = ET.parse(svg_path)
    root = tree.getroot()
    ns = "{http://www.w3.org/2000/svg}"
    path = root.find(f".//{ns}path")
    d = path.get("d", "")

    # Format: M4,4h1v1h-1z M5,4h1v1h-1z ...
    squares = set()
    origin = None
    for m in re.finditer(r"M(\d+),(\d+)", d):
        x, y = int(m.group(1)), int(m.group(2))
        if origin is None:
            origin = (x, y)
        squares.add((x - origin[0], y - origin[1]))

    return squares


def finder_pattern_zones() -> set[tuple[int, int]]:
    """Return the set of (col, row) cells covered by the 3 finder patterns.

    Each finder pattern is 7x7, plus a 1-cell separator on the inner sides.
    We exclude an 8x8 block for each corner (the separator row/col).
    """
    zones = set()
    # Top-left: cols 0-7, rows 0-7
    for c in range(8):
        for r in range(8):
            zones.add((c, r))
    # Top-right: cols 25-32, rows 0-7
    for c in range(25, QR_SIZE):
        for r in range(8):
            zones.add((c, r))
    # Bottom-left: cols 0-7, rows 25-32
    for c in range(8):
        for r in range(25, QR_SIZE):
            zones.add((c, r))
    return zones


def print_grid(squares: set[tuple[int, int]], label: str = ""):
    """Print a text visualization of the grid."""
    if label:
        print(f"\n=== {label} ===")
    cols = [s[0] for s in squares]
    rows = [s[1] for s in squares]
    min_c, max_c = min(cols), max(cols)
    min_r, max_r = min(rows), max(rows)

    for r in range(min_r, max_r + 1):
        line = ""
        for c in range(min_c, max_c + 1):
            line += "#" if (c, r) in squares else "."
        print(line)


def main():
    qr = parse_qr(INPUT_SVG)
    print(f"Parsed {len(qr)} squares from {INPUT_SVG}")
    print_grid(qr, "Original QR code")

    zones = finder_pattern_zones()
    filtered = qr - zones
    print(f"\nRemoved {len(qr) - len(filtered)} squares in finder pattern zones")
    print(f"Remaining: {len(filtered)} squares")
    print_grid(filtered, "QR code without finder patterns")


if __name__ == "__main__":
    main()
