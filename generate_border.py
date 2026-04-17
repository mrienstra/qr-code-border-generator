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
CIRCLE_RATIO = 27 / 33  # circle radius as a proportion of QR size (default 0.81818)
CIRCLE_MARGIN = 3  # space between circle edge and viewBox edge
CIRCLE_STROKE_WIDTH = 2

# Cycle through these for debug coloring: center, then alternating flanks
DEBUG_PALETTE = {
    "top": ["#888888", "#cc4444", "#4444cc", "#cc8844", "#4488cc"],
    "bottom": ["#aaaaaa", "#ee8888", "#8888ee", "#eeaa88", "#88aaee"],
    "left": ["#888888", "#cc4444", "#4444cc", "#cc8844", "#4488cc"],
    "right": ["#aaaaaa", "#ee8888", "#8888ee", "#eeaa88", "#88aaee"],
}


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


def compute_layout(qr_size: int, circle_ratio: float = CIRCLE_RATIO,
                    stroke_width: float = CIRCLE_STROKE_WIDTH) -> dict:
    """Compute SVG layout values from QR size."""
    circle_r = qr_size * circle_ratio
    svg_size = 2 * circle_r + 2 * CIRCLE_MARGIN
    qr_origin = (svg_size - qr_size) / 2
    return {
        "qr_size": qr_size,
        "svg_size": svg_size,
        "qr_origin": qr_origin,
        "circle_cx": svg_size / 2,
        "circle_cy": svg_size / 2,
        "circle_r": circle_r,
        "stroke_width": stroke_width,
    }


def trim_edges(
    squares: set[tuple[int, int]],
    qr_size: int,
    left: bool = False,
    right: bool = False,
    top: bool = False,
    bottom: bool = False,
) -> set[tuple[int, int]]:
    """Remove cells along specified edges (FINDER_ZONE pixels deep)."""
    return {
        (c, r)
        for c, r in squares
        if not (left and c < FINDER_ZONE)
        and not (right and c >= qr_size - FINDER_ZONE)
        and not (top and r < FINDER_ZONE)
        and not (bottom and r >= qr_size - FINDER_ZONE)
    }


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


def trim_corners_diagonal(
    squares: set[tuple[float, float]], layout: dict, trim_dx_ge_dy: bool
) -> set[tuple[float, float]]:
    """Trim pixels along 45-degree diagonals in corner regions.

    In each corner (where a pixel is outside the QR area on two axes),
    a diagonal line divides the space between the two adjacent groups.
    Pixels on the diagonal are "no man's land" (removed from both groups).

    trim_dx_ge_dy=True  (top/bottom): remove where horiz dist >= vert dist
    trim_dx_ge_dy=False (left/right):  remove where vert dist >= horiz dist
    """
    qo = layout["qr_origin"]
    qe = qo + layout["qr_size"]

    result = set()
    for x, y in squares:
        dx = dy = None
        if x < qo and y < qo:          # top-left corner
            dx, dy = qo - x, qo - y
        elif x >= qe and y < qo:        # top-right corner
            dx, dy = x - qe + 1, qo - y
        elif x < qo and y >= qe:        # bottom-left corner
            dx, dy = qo - x, y - qe + 1
        elif x >= qe and y >= qe:       # bottom-right corner
            dx, dy = x - qe + 1, y - qe + 1

        if dx is not None:
            if trim_dx_ge_dy and dx >= dy:
                continue
            if not trim_dx_ge_dy and dy >= dx:
                continue

        result.add((x, y))
    return result


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


def make_top_group(qr, layout, reps=2):
    qr_size, qr_origin = layout["qr_size"], layout["qr_origin"]
    y_offset = qr_origin - GAP - qr_size

    trimmed = trim_edges(qr, qr_size, left=True, right=True)
    center = flip_vertical(trimmed, qr_size)
    flanks = make_flanking_h(center, qr_size, FLANK_INSET, FLANK_INSET, reps=reps)

    result = [("top center", offset_to_svg(center, qr_origin, y_offset))]
    for side, squares in flanks:
        result.append((f"top {side}", offset_to_svg(squares, qr_origin, y_offset)))
    return [(l, trim_corners_diagonal(s, layout, trim_dx_ge_dy=True)) for l, s in result]


def make_bottom_group(qr, layout):
    qr_size, qr_origin = layout["qr_size"], layout["qr_origin"]
    y_offset = qr_origin + qr_size + GAP

    trimmed = trim_edges(qr, qr_size, left=True)
    center = flip_vertical(trimmed, qr_size)
    flanks = make_flanking_h(center, qr_size, FLANK_INSET_NO_FINDER, FLANK_INSET)

    result = [("bottom center", offset_to_svg(center, qr_origin, y_offset))]
    for side, squares in flanks:
        result.append((f"bottom {side}", offset_to_svg(squares, qr_origin, y_offset)))
    return [(l, trim_corners_diagonal(s, layout, trim_dx_ge_dy=True)) for l, s in result]


def make_left_group(qr, layout, reps=2):
    qr_size, qr_origin = layout["qr_size"], layout["qr_origin"]
    x_offset = qr_origin - GAP - qr_size

    trimmed = trim_edges(qr, qr_size, top=True, bottom=True)
    center = flip_horizontal(trimmed, qr_size)
    flanks = make_flanking_v(center, qr_size, FLANK_INSET, FLANK_INSET, reps=reps)

    result = [("left center", offset_to_svg(center, x_offset, qr_origin))]
    for side, squares in flanks:
        result.append((f"left {side}", offset_to_svg(squares, x_offset, qr_origin)))
    return [(l, trim_corners_diagonal(s, layout, trim_dx_ge_dy=False)) for l, s in result]


def make_right_group(qr, layout):
    qr_size, qr_origin = layout["qr_size"], layout["qr_origin"]
    x_offset = qr_origin + qr_size + GAP

    trimmed = trim_edges(qr, qr_size, top=True)
    center = flip_horizontal(trimmed, qr_size)
    flanks = make_flanking_v(center, qr_size, FLANK_INSET_NO_FINDER, FLANK_INSET)

    result = [("right center", offset_to_svg(center, x_offset, qr_origin))]
    for side, squares in flanks:
        result.append((f"right {side}", offset_to_svg(squares, x_offset, qr_origin)))
    return [(l, trim_corners_diagonal(s, layout, trim_dx_ge_dy=False)) for l, s in result]


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
        f' fill="none" stroke="#000000" stroke-width="{fmt(layout["stroke_width"])}"/>'
    )
    lines.append("</svg>")

    with open(output, "w") as f:
        f.write("\n".join(lines))
    print(f"\nWrote {output}")


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
    parser.add_argument(
        "--circle-ratio",
        type=float,
        default=CIRCLE_RATIO,
        help=f"Circle radius as proportion of QR size (default: {CIRCLE_RATIO:.4f})",
    )
    parser.add_argument(
        "--stroke-width",
        type=float,
        default=CIRCLE_STROKE_WIDTH,
        help=f"Circle border stroke width (default: {CIRCLE_STROKE_WIDTH})",
    )
    args = parser.parse_args()

    qr, qr_size = parse_qr(args.input)
    layout = compute_layout(qr_size, args.circle_ratio, args.stroke_width)
    print(
        f"Parsed {len(qr)} squares, SVG {layout['svg_size']}x{layout['svg_size']}, "
        f"circle r={layout['circle_r']}"
    )

    # Original QR code path (in SVG coordinates)
    qr_svg = offset_to_svg(qr, layout["qr_origin"], layout["qr_origin"])
    qr_path = squares_to_path(qr_svg)

    all_groups = [
        ("top", make_top_group(qr, layout)),
        ("bottom", make_bottom_group(qr, layout)),
        ("left", make_left_group(qr, layout)),
        ("right", make_right_group(qr, layout)),
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
