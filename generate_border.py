#!/usr/bin/env python3
"""Generate a QR code border SVG from a plain QR code SVG."""

import argparse
import re
import xml.etree.ElementTree as ET

# --- Fixed constants ---
FINDER_ZONE = 8  # 7x7 finder pattern + 1 separator
GAP = 1  # gap between QR and orthogonal copies
FLANK_GAP = 1  # gap between orthogonal copies and flanking copies
FLANK_INSET = 2 * FINDER_ZONE - FLANK_GAP  # both corners have finders (15)
FLANK_INSET_NO_FINDER = -FLANK_GAP  # adjacent corner has no finder (-1)

# --- Circle / layout ---
CIRCLE_RATIO = 27 / 33  # circle radius as a proportion of QR size
CIRCLE_MARGIN = 3  # space between circle edge and viewBox edge
CIRCLE_STROKE_WIDTH = 2


def parse_qr(svg_path: str) -> tuple[set[tuple[int, int]], int]:
    """Parse QR code SVG and return (squares, qr_size).

    squares: set of (col, row) coordinates, 0-indexed.
    qr_size: detected grid size (e.g. 21, 25, 29, 33).
    """
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

    max_c = max(c for c, r in squares)
    qr_size = max_c + 1
    version = (qr_size - 17) // 4
    print(f"Detected QR version {version}: {qr_size}x{qr_size} grid")

    return squares, qr_size


def compute_layout(qr_size: int) -> dict:
    """Compute SVG layout values from QR size."""
    circle_r = qr_size * CIRCLE_RATIO
    svg_size = 2 * circle_r + 2 * CIRCLE_MARGIN
    qr_origin = (svg_size - qr_size) / 2
    return {
        "qr_size": qr_size,
        "svg_size": svg_size,
        "qr_origin": qr_origin,
        "circle_cx": svg_size / 2,
        "circle_cy": svg_size / 2,
        "circle_r": circle_r,
    }


def finder_pattern_zones(qr_size: int) -> set[tuple[int, int]]:
    """Return the set of (col, row) cells covered by the 3 finder patterns.

    Each finder pattern is 7x7, plus a 1-cell separator on the inner sides.
    We exclude an 8x8 block for each corner (the separator row/col).
    """
    zones = set()
    # Top-left: cols 0-7, rows 0-7
    for c in range(8):
        for r in range(8):
            zones.add((c, r))
    # Top-right: cols (qr_size-8)...(qr_size-1), rows 0-7
    for c in range(qr_size - 8, qr_size):
        for r in range(8):
            zones.add((c, r))
    # Bottom-left: cols 0-7, rows (qr_size-8)...(qr_size-1)
    for c in range(8):
        for r in range(qr_size - 8, qr_size):
            zones.add((c, r))
    return zones


def squares_to_path(squares: set[tuple[float, float]]) -> str:
    """Convert a set of (x, y) SVG coordinates to an SVG path string."""
    sorted_squares = sorted(squares, key=lambda s: (s[1], s[0]))
    parts = []
    for x, y in sorted_squares:
        xf = int(x) if x == int(x) else f"{x:.1f}"
        yf = int(y) if y == int(y) else f"{y:.1f}"
        parts.append(f"M{xf},{yf}h1v1h-1z")
    return " ".join(parts)


def flip_vertical(squares: set[tuple[int, int]], qr_size: int) -> set[tuple[int, int]]:
    """Flip a set of grid coordinates vertically."""
    return {(c, qr_size - 1 - r) for c, r in squares}


def flip_horizontal(squares: set[tuple[int, int]], qr_size: int) -> set[tuple[int, int]]:
    """Flip a set of grid coordinates horizontally."""
    return {(qr_size - 1 - c, r) for c, r in squares}


def shift(squares: set[tuple[int, int]], dc: int, dr: int) -> set[tuple[int, int]]:
    """Shift grid coordinates by (dc, dr)."""
    return {(c + dc, r + dr) for c, r in squares}


def offset_to_svg(
    squares: set[tuple[int, int]], x_offset: float, y_offset: float
) -> set[tuple[float, float]]:
    """Convert grid coordinates to SVG coordinates with an offset."""
    return {(x_offset + c, y_offset + r) for c, r in squares}


def make_flanking_h(
    center: set[tuple[int, int]],
    qr_size: int,
    right_inset: int,
    left_inset: int,
    reps: int = 1,
):
    """Create left and right flanking copies from a center copy.

    Each flanking copy is the center mirrored horizontally, then shifted left/right.
    With reps > 1, additional copies are placed further out at multiples of the shift.
    Used by top/bottom groups.
    """
    mirrored = flip_horizontal(center, qr_size)
    right_step = qr_size - right_inset
    left_step = qr_size - left_inset
    results = []
    for i in range(1, reps + 1):
        copy = mirrored if i % 2 == 1 else center
        results.append(("left", shift(copy, -left_step * i, 0)))
        results.append(("right", shift(copy, right_step * i, 0)))
    return results


def make_flanking_v(
    center: set[tuple[int, int]],
    qr_size: int,
    lower_inset: int,
    upper_inset: int,
    reps: int = 1,
):
    """Create upper and lower flanking copies from a center copy.

    Each flanking copy is the center mirrored vertically, then shifted up/down.
    With reps > 1, additional copies are placed further out at multiples of the shift.
    Used by left/right groups.
    """
    mirrored = flip_vertical(center, qr_size)
    upper_step = qr_size - upper_inset
    lower_step = qr_size - lower_inset
    results = []
    for i in range(1, reps + 1):
        copy = mirrored if i % 2 == 1 else center
        results.append(("upper", shift(copy, 0, -upper_step * i)))
        results.append(("lower", shift(copy, 0, lower_step * i)))
    return results


def make_top_group(filtered, layout, reps=2):
    qr_size, qr_origin = layout["qr_size"], layout["qr_origin"]
    y_offset = qr_origin - GAP - qr_size

    center = flip_vertical(filtered, qr_size)
    flanks = make_flanking_h(center, qr_size, FLANK_INSET, FLANK_INSET, reps=reps)

    result = [("top center", offset_to_svg(center, qr_origin, y_offset))]
    for side, squares in flanks:
        result.append((f"top {side}", offset_to_svg(squares, qr_origin, y_offset)))
    return result


def make_bottom_group(filtered, layout):
    qr_size, qr_origin = layout["qr_size"], layout["qr_origin"]
    y_offset = qr_origin + qr_size + GAP

    center = flip_vertical(filtered, qr_size)
    flanks = make_flanking_h(center, qr_size, FLANK_INSET_NO_FINDER, FLANK_INSET)

    result = [("bottom center", offset_to_svg(center, qr_origin, y_offset))]
    for side, squares in flanks:
        result.append((f"bottom {side}", offset_to_svg(squares, qr_origin, y_offset)))
    return result


def make_left_group(filtered, layout, reps=2):
    qr_size, qr_origin = layout["qr_size"], layout["qr_origin"]
    x_offset = qr_origin - GAP - qr_size

    center = flip_horizontal(filtered, qr_size)
    flanks = make_flanking_v(center, qr_size, FLANK_INSET, FLANK_INSET, reps=reps)

    result = [("left center", offset_to_svg(center, x_offset, qr_origin))]
    for side, squares in flanks:
        result.append((f"left {side}", offset_to_svg(squares, x_offset, qr_origin)))
    return result


def make_right_group(filtered, layout):
    qr_size, qr_origin = layout["qr_size"], layout["qr_origin"]
    x_offset = qr_origin + qr_size + GAP

    center = flip_horizontal(filtered, qr_size)
    flanks = make_flanking_v(center, qr_size, FLANK_INSET_NO_FINDER, FLANK_INSET)

    result = [("right center", offset_to_svg(center, x_offset, qr_origin))]
    for side, squares in flanks:
        result.append((f"right {side}", offset_to_svg(squares, x_offset, qr_origin)))
    return result


def fmt(v: float) -> str:
    """Format a number for SVG: drop trailing zeros, use int if whole."""
    if v == int(v):
        return str(int(v))
    return f"{v:g}"


def write_svg(
    qr_path: str,
    decoration_paths: list[tuple[str, str, str]],
    layout: dict,
    output: str,
):
    svg_size = fmt(layout["svg_size"])
    cx, cy, r = fmt(layout["circle_cx"]), fmt(layout["circle_cy"]), fmt(layout["circle_r"])
    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {svg_size} {svg_size}">',
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
        f' fill="none" stroke="#000000" stroke-width="{CIRCLE_STROKE_WIDTH}"/>'
    )
    lines.append("</svg>")

    with open(output, "w") as f:
        f.write("\n".join(lines))
    print(f"\nWrote {output}")


# Cycle through these for debug coloring: center, then alternating flanks
DEBUG_PALETTE = {
    "top": ["#888888", "#cc4444", "#4444cc", "#cc8844", "#4488cc"],
    "bottom": ["#aaaaaa", "#ee8888", "#8888ee", "#eeaa88", "#88aaee"],
    "left": ["#888888", "#cc4444", "#4444cc", "#cc8844", "#4488cc"],
    "right": ["#aaaaaa", "#ee8888", "#8888ee", "#eeaa88", "#88aaee"],
}


def main():
    parser = argparse.ArgumentParser(description="Generate QR code border SVG")
    parser.add_argument(
        "input",
        nargs="?",
        default="qr-code-original.svg",
        help="Input QR code SVG file (default: qr-code-original.svg)",
    )
    parser.add_argument(
        "-o",
        "--output",
        default="qr-code-generated.svg",
        help="Output SVG file (default: qr-code-generated.svg)",
    )
    parser.add_argument(
        "--colorful",
        action="store_true",
        help="Use distinct colors per copy for debugging",
    )
    args = parser.parse_args()

    qr, qr_size = parse_qr(args.input)
    layout = compute_layout(qr_size)
    print(
        f"Parsed {len(qr)} squares, SVG {layout['svg_size']}x{layout['svg_size']}, "
        f"circle r={layout['circle_r']}"
    )

    zones = finder_pattern_zones(qr_size)
    filtered = qr - zones
    print(f"Filtered: {len(filtered)} squares (removed {len(qr) - len(filtered)} in finder zones)")

    # Original QR code path (in SVG coordinates)
    qr_svg = offset_to_svg(qr, layout["qr_origin"], layout["qr_origin"])
    qr_path = squares_to_path(qr_svg)

    all_groups = [
        ("top", make_top_group(filtered, layout)),
        ("bottom", make_bottom_group(filtered, layout)),
        ("left", make_left_group(filtered, layout)),
        ("right", make_right_group(filtered, layout)),
    ]

    decoration_paths = []
    for group_name, group in all_groups:
        palette = DEBUG_PALETTE[group_name] if args.colorful else None
        for i, (label, svg_squares) in enumerate(group):
            color = palette[i % len(palette)] if palette else "#000000"
            path_d = squares_to_path(svg_squares)
            print(f"{label}: {len(svg_squares)} squares")
            decoration_paths.append((label, path_d, color))

    write_svg(qr_path, decoration_paths, layout, args.output)


if __name__ == "__main__":
    main()
