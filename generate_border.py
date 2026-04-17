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


def flip_horizontal(squares: set[tuple[int, int]]) -> set[tuple[int, int]]:
    """Flip a set of grid coordinates horizontally."""
    return {(QR_SIZE - 1 - c, r) for c, r in squares}


def shift(squares: set[tuple[int, int]], dc: int, dr: int) -> set[tuple[int, int]]:
    """Shift grid coordinates by (dc, dr)."""
    return {(c + dc, r + dr) for c, r in squares}


def offset_to_svg(
    squares: set[tuple[int, int]], x_offset: float, y_offset: float
) -> set[tuple[float, float]]:
    """Convert grid coordinates to SVG coordinates with an offset."""
    return {(x_offset + c, y_offset + r) for c, r in squares}


FINDER_ZONE = 8  # 7x7 finder pattern + 1 separator


def make_top_center(filtered: set[tuple[int, int]]) -> set[tuple[int, int]]:
    """Create the top-center copy: vertically flipped, in grid coordinates."""
    return flip_vertical(filtered)


def make_top_right(top_center: set[tuple[int, int]]) -> set[tuple[int, int]]:
    """Create the top-right flanking copy: mirror center horizontally, shift right.

    Shifted inward by FINDER_ZONE so it overlaps the gap left by the
    removed top-right finder pattern.
    """
    mirrored = flip_horizontal(top_center)
    return shift(mirrored, QR_SIZE - FINDER_ZONE, 0)


def make_top_left(top_center: set[tuple[int, int]]) -> set[tuple[int, int]]:
    """Create the top-left flanking copy: mirror center horizontally, shift left.

    Shifted inward by FINDER_ZONE so it overlaps the gap left by the
    removed top-left finder pattern.
    """
    mirrored = flip_horizontal(top_center)
    return shift(mirrored, -(QR_SIZE - FINDER_ZONE), 0)


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


def make_top_group(filtered: set[tuple[int, int]]) -> list[tuple[str, set[tuple[float, float]]]]:
    """Build the full top decoration group.

    Returns list of (label, svg_squares) tuples.
    """
    # All top copies share the same y offset (above QR with GAP)
    y_offset = QR_ORIGIN - GAP - QR_SIZE

    top_center = make_top_center(filtered)
    top_right = make_top_right(top_center)
    top_left = make_top_left(top_center)

    return [
        ("top center", offset_to_svg(top_center, QR_ORIGIN, y_offset)),
        ("top right", offset_to_svg(top_right, QR_ORIGIN, y_offset)),
        ("top left", offset_to_svg(top_left, QR_ORIGIN, y_offset)),
    ]


def main():
    qr = parse_qr(INPUT_SVG)
    print(f"Parsed {len(qr)} squares from {INPUT_SVG}")

    zones = finder_pattern_zones()
    filtered = qr - zones
    print(f"Filtered: {len(filtered)} squares (removed {len(qr) - len(filtered)} in finder zones)")

    # Original QR code path (in SVG coordinates)
    qr_svg = offset_to_svg(qr, QR_ORIGIN, QR_ORIGIN)
    qr_path = squares_to_path(qr_svg)

    # Top group
    top_group = make_top_group(filtered)
    decoration_paths = []
    for label, svg_squares in top_group:
        path_d = squares_to_path(svg_squares)
        print(f"{label}: {len(svg_squares)} squares")
        decoration_paths.append((label, path_d))

    # Write SVG
    write_svg(qr_path, decoration_paths, OUTPUT_SVG)


if __name__ == "__main__":
    main()
