#!/usr/bin/env python3
"""Generate a QR code border SVG from a plain QR code SVG."""

import re
import xml.etree.ElementTree as ET

INPUT_SVG = "qr-code-original.svg"
OUTPUT_SVG = "qr-code-generated.svg"
QR_SIZE = 33  # 33x33 modules
SVG_SIZE = 60  # output viewBox
QR_ORIGIN = (SVG_SIZE - QR_SIZE) / 2  # 13.5 — centers QR in viewBox
GAP = 1  # gap between QR and orthogonal copies
FLANK_GAP = 1  # gap between orthogonal copies and flanking copies


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
FLANK_INSET = 2 * FINDER_ZONE - FLANK_GAP  # inset when both corners have finders (8+8-1=15)
FLANK_INSET_NO_FINDER = -FLANK_GAP  # outset when the adjacent corner has no finder (-1)


def make_top_center(filtered: set[tuple[int, int]]) -> set[tuple[int, int]]:
    """Create the top-center copy: vertically flipped, in grid coordinates."""
    return flip_vertical(filtered)


def make_top_right(top_center: set[tuple[int, int]]) -> set[tuple[int, int]]:
    """Create the top-right flanking copy: mirror center horizontally, shift right.

    Shifted inward by FINDER_ZONE so it overlaps the gap left by the
    removed top-right finder pattern.
    """
    mirrored = flip_horizontal(top_center)
    return shift(mirrored, QR_SIZE - FLANK_INSET, 0)


def make_top_left(top_center: set[tuple[int, int]]) -> set[tuple[int, int]]:
    """Create the top-left flanking copy: mirror center horizontally, shift left.

    Shifted inward by FLANK_INSET so it overlaps the gap left by the
    removed top-left finder pattern.
    """
    mirrored = flip_horizontal(top_center)
    return shift(mirrored, -(QR_SIZE - FLANK_INSET), 0)


CIRCLE_CX = SVG_SIZE / 2  # 30
CIRCLE_CY = SVG_SIZE / 2  # 30
CIRCLE_R = 27


def write_svg(
    qr_path: str,
    decoration_paths: list[tuple[str, str, str]],
    output: str,
):
    """Write an SVG file with the QR code and decoration paths.

    decoration_paths: list of (label, path_d, fill_color) tuples.
    """
    cx, cy, r = CIRCLE_CX, CIRCLE_CY, CIRCLE_R
    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SVG_SIZE} {SVG_SIZE}">',
        '  <rect width="100%" height="100%" fill="#ffffff"/>',
        "  <defs>",
        '    <clipPath id="circle-clip">',
        f'      <circle cx="{cx}" cy="{cy}" r="{r}"/>',
        "    </clipPath>",
        "  </defs>",
        '  <g clip-path="url(#circle-clip)">',
        f'    <path d="{qr_path}"/>',
    ]
    for label, path_d, color in decoration_paths:
        lines.append(f'    <!-- {label} -->')
        lines.append(f'    <path d="{path_d}" fill="{color}"/>')
    lines.append("  </g>")
    lines.append(
        f'  <circle cx="{cx}" cy="{cy}" r="{r}"'
        f' fill="none" stroke="#000000" stroke-width="2"/>'
    )
    lines.append("</svg>")

    with open(output, "w") as f:
        f.write("\n".join(lines))
    print(f"\nWrote {output}")


def make_flanking_h(center: set[tuple[int, int]], right_inset: int, left_inset: int):
    """Create left and right flanking copies from a center copy.

    Each flanking copy is the center mirrored horizontally, then shifted left/right.
    Used by top/bottom groups.
    """
    mirrored = flip_horizontal(center)
    right = shift(mirrored, QR_SIZE - right_inset, 0)
    left = shift(mirrored, -(QR_SIZE - left_inset), 0)
    return left, right


def make_flanking_v(center: set[tuple[int, int]], lower_inset: int, upper_inset: int):
    """Create upper and lower flanking copies from a center copy.

    Each flanking copy is the center mirrored vertically, then shifted up/down.
    Used by left/right groups.
    """
    mirrored = flip_vertical(center)
    upper = shift(mirrored, 0, -(QR_SIZE - upper_inset))
    lower = shift(mirrored, 0, QR_SIZE - lower_inset)
    return upper, lower


def make_top_group(filtered: set[tuple[int, int]]) -> list[tuple[str, set[tuple[float, float]]]]:
    """Build the full top decoration group.

    Returns list of (label, svg_squares) tuples.
    """
    y_offset = QR_ORIGIN - GAP - QR_SIZE

    center = flip_vertical(filtered)
    left, right = make_flanking_h(center, FLANK_INSET, FLANK_INSET)

    return [
        ("top center", offset_to_svg(center, QR_ORIGIN, y_offset)),
        ("top right", offset_to_svg(right, QR_ORIGIN, y_offset)),
        ("top left", offset_to_svg(left, QR_ORIGIN, y_offset)),
    ]


def make_bottom_group(filtered: set[tuple[int, int]]) -> list[tuple[str, set[tuple[float, float]]]]:
    """Build the full bottom decoration group.

    Same vertical flip as top, but positioned below QR.
    The bottom-right corner has no finder pattern, so the right flanking
    may need a different inset than the left.
    """
    y_offset = QR_ORIGIN + QR_SIZE + GAP

    center = flip_vertical(filtered)
    # Left flanking: full inset (bottom-left has a finder pattern)
    # Right flanking: less inset (bottom-right has NO finder pattern)
    left, right = make_flanking_h(center, FLANK_INSET_NO_FINDER, FLANK_INSET)

    return [
        ("bottom center", offset_to_svg(center, QR_ORIGIN, y_offset)),
        ("bottom right", offset_to_svg(right, QR_ORIGIN, y_offset)),
        ("bottom left", offset_to_svg(left, QR_ORIGIN, y_offset)),
    ]


def make_left_group(filtered: set[tuple[int, int]]) -> list[tuple[str, set[tuple[float, float]]]]:
    """Build the left decoration group.

    Center copy is horizontally flipped, positioned to the left of QR.
    Left side has finder patterns in both corners (top-left + bottom-left),
    so both flanking copies use full FLANK_INSET.
    """
    x_offset = QR_ORIGIN - GAP - QR_SIZE

    center = flip_horizontal(filtered)
    upper, lower = make_flanking_v(center, FLANK_INSET, FLANK_INSET)

    return [
        ("left center", offset_to_svg(center, x_offset, QR_ORIGIN)),
        ("left upper", offset_to_svg(upper, x_offset, QR_ORIGIN)),
        ("left lower", offset_to_svg(lower, x_offset, QR_ORIGIN)),
    ]


def make_right_group(filtered: set[tuple[int, int]]) -> list[tuple[str, set[tuple[float, float]]]]:
    """Build the right decoration group.

    Center copy is horizontally flipped, positioned to the right of QR.
    Right side has a finder pattern only in the top-right corner (no bottom-right),
    so the lower flanking uses FLANK_INSET_NO_FINDER.
    """
    x_offset = QR_ORIGIN + QR_SIZE + GAP

    center = flip_horizontal(filtered)
    # Upper flanking: full inset (top-right has a finder pattern)
    # Lower flanking: no-finder inset (bottom-right has NO finder pattern)
    upper, lower = make_flanking_v(center, FLANK_INSET_NO_FINDER, FLANK_INSET)

    return [
        ("right center", offset_to_svg(center, x_offset, QR_ORIGIN)),
        ("right upper", offset_to_svg(upper, x_offset, QR_ORIGIN)),
        ("right lower", offset_to_svg(lower, x_offset, QR_ORIGIN)),
    ]


DEBUG_COLORS = {
    "top": ["#888888", "#cc4444", "#4444cc"],
    "bottom": ["#aaaaaa", "#ee8888", "#8888ee"],
    "left": ["#888888", "#cc4444", "#4444cc"],
    "right": ["#aaaaaa", "#ee8888", "#8888ee"],
}


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Generate QR code border SVG")
    parser.add_argument(
        "--colorful",
        action="store_true",
        help="Use distinct colors per copy for debugging",
    )
    args = parser.parse_args()

    qr = parse_qr(INPUT_SVG)
    print(f"Parsed {len(qr)} squares from {INPUT_SVG}")

    zones = finder_pattern_zones()
    filtered = qr - zones
    print(f"Filtered: {len(filtered)} squares (removed {len(qr) - len(filtered)} in finder zones)")

    # Original QR code path (in SVG coordinates)
    qr_svg = offset_to_svg(qr, QR_ORIGIN, QR_ORIGIN)
    qr_path = squares_to_path(qr_svg)

    all_groups = [
        ("top", make_top_group(filtered)),
        ("bottom", make_bottom_group(filtered)),
        ("left", make_left_group(filtered)),
        ("right", make_right_group(filtered)),
    ]

    decoration_paths = []
    for group_name, group in all_groups:
        colors = DEBUG_COLORS[group_name] if args.colorful else ["#000000"] * 3
        for (label, svg_squares), color in zip(group, colors):
            path_d = squares_to_path(svg_squares)
            print(f"{label}: {len(svg_squares)} squares")
            decoration_paths.append((label, path_d, color))

    # Write SVG
    write_svg(qr_path, decoration_paths, OUTPUT_SVG)


if __name__ == "__main__":
    main()
