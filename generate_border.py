#!/usr/bin/env python3
"""Generate a QR code border SVG from a plain QR code SVG."""

import re
import xml.etree.ElementTree as ET

INPUT_SVG = "qr-code-original.svg"
OUTPUT_SVG = "qr-code-generated.svg"
QR_SIZE = 33  # 33x33 modules
SVG_SIZE = 60  # output viewBox
QR_ORIGIN = (SVG_SIZE - QR_SIZE) / 2  # 13.5 — centers QR in viewBox
GAP = 1  # gap between QR and decoration copies


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


def squares_to_path(squares: set[tuple[float, float]]) -> str:
    """Convert a set of (x, y) SVG coordinates to an SVG path string."""
    # Sort for deterministic output: top-to-bottom, left-to-right
    sorted_squares = sorted(squares, key=lambda s: (s[1], s[0]))
    parts = []
    for x, y in sorted_squares:
        # Format coordinates: use int if whole number, else one decimal
        xf = int(x) if x == int(x) else f"{x:.1f}"
        yf = int(y) if y == int(y) else f"{y:.1f}"
        parts.append(f"M{xf},{yf}h1v1h-1z")
    return " ".join(parts)


def flip_vertical(squares: set[tuple[int, int]]) -> set[tuple[int, int]]:
    """Flip a set of grid coordinates vertically."""
    return {(c, QR_SIZE - 1 - r) for c, r in squares}


def offset_to_svg(
    squares: set[tuple[int, int]], x_offset: float, y_offset: float
) -> set[tuple[float, float]]:
    """Convert grid coordinates to SVG coordinates with an offset."""
    return {(x_offset + c, y_offset + r) for c, r in squares}


def make_top_center(filtered: set[tuple[int, int]]) -> set[tuple[float, float]]:
    """Create the top-center copy: vertically flipped, positioned above QR."""
    flipped = flip_vertical(filtered)
    # Position so that the bottom edge of the copy is GAP pixels above the QR top.
    # Flipped row 32 (max) should have its bottom edge at QR_ORIGIN - GAP.
    # So its y = QR_ORIGIN - GAP - 1. offset_y + 32 = QR_ORIGIN - GAP - 1.
    # offset_y = QR_ORIGIN - GAP - 1 - 32 = QR_ORIGIN - GAP - QR_SIZE
    y_offset = QR_ORIGIN - GAP - QR_SIZE
    return offset_to_svg(flipped, QR_ORIGIN, y_offset)


def write_svg(qr_path: str, decoration_paths: list[tuple[str, str]], output: str):
    """Write an SVG file with the QR code and decoration paths."""
    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SVG_SIZE} {SVG_SIZE}">',
        '  <rect width="100%" height="100%" fill="#ffffff"/>',
        f'  <path d="{qr_path}"/>',
    ]
    for label, path_d in decoration_paths:
        lines.append(f'  <!-- {label} -->')
        lines.append(f'  <path d="{path_d}" fill="#888888"/>')
    lines.append("</svg>")

    with open(output, "w") as f:
        f.write("\n".join(lines))
    print(f"\nWrote {output}")


def main():
    qr = parse_qr(INPUT_SVG)
    print(f"Parsed {len(qr)} squares from {INPUT_SVG}")

    zones = finder_pattern_zones()
    filtered = qr - zones
    print(f"Filtered: {len(filtered)} squares (removed {len(qr) - len(filtered)} in finder zones)")

    # Original QR code path (in SVG coordinates)
    qr_svg = offset_to_svg(qr, QR_ORIGIN, QR_ORIGIN)
    qr_path = squares_to_path(qr_svg)

    # Top center copy
    top_center = make_top_center(filtered)
    top_center_path = squares_to_path(top_center)
    print(f"Top center copy: {len(top_center)} squares")

    # Print text grid for verification
    print_grid(filtered, "Filtered QR (grid coords)")
    flipped = flip_vertical(filtered)
    print_grid(flipped, "Flipped vertically (grid coords)")

    # Write SVG
    write_svg(qr_path, [("top center", top_center_path)], OUTPUT_SVG)


if __name__ == "__main__":
    main()
